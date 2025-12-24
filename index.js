const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const mongoose = require("mongoose");
const config = require("./config");
const Stock = require("./models/Stock");
const Orders = require("./models/Orders");

/* ================= BRAND ================= */
const BRAND = config.brand;

function createEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor({ name: BRAND.name, iconURL: BRAND.logo })
    .setFooter({ text: BRAND.footer, iconURL: BRAND.logo })
    .setTimestamp();
}

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= MONGODB ================= */
mongoose
  .connect(config.mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));

/* ================= READY ================= */
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  await client.application.commands.set([
    new SlashCommandBuilder()
      .setName("request")
      .setDescription("Request a product")
      .addStringOption(o =>
        o.setName("product").setDescription("minecraft / crunchyroll").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("addstock")
      .setDescription("Add stock (Admin only)")
      .addStringOption(o =>
        o.setName("product").setDescription("minecraft / crunchyroll").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("data").setDescription("Gift code or account").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("stockcount")
      .setDescription("View available stock count")
  ]);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {

  /* ---------- /request ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === "request") {
    await interaction.deferReply({ ephemeral: true });

    const product = interaction.options.getString("product");
    const orderId = `ORD-${Date.now()}`;

    await Orders.create({
      orderId,
      userId: interaction.user.id,
      product,
      status: "pending"
    });

    const adminEmbed = createEmbed()
      .setTitle("🛒 New Order Request")
      .addFields(
        { name: "👤 User", value: `<@${interaction.user.id}>`, inline: true },
        { name: "📦 Product", value: product, inline: true },
        { name: "🆔 Order ID", value: orderId, inline: true }
      );

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${orderId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${orderId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
    );

    const adminChannel = client.channels.cache.get(config.adminChannelID);
    if (adminChannel) adminChannel.send({ embeds: [adminEmbed], components: [buttons] });

    await interaction.editReply({
      embeds: [
        createEmbed()
          .setTitle("✅ Order Submitted")
          .setDescription("⏳ Waiting for admin approval.")
          .addFields(
            { name: "📦 Product", value: product, inline: true },
            { name: "🆔 Order ID", value: orderId, inline: true }
          )
      ]
    });
  }

  /* ---------- /addstock ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === "addstock") {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member.roles.cache.has(config.adminRoleID))
      return interaction.editReply("❌ Admin only command.");

    await Stock.create({
      product: interaction.options.getString("product"),
      data: interaction.options.getString("data"),
      used: false
    });

    await interaction.editReply({
      embeds: [createEmbed().setTitle("✅ Stock Added")]
    });
  }

  /* ---------- /stockcount ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === "stockcount") {
    await interaction.deferReply({ ephemeral: true });

    const stocks = await Stock.find({ used: false });
    if (!stocks.length) return interaction.editReply("❌ No stock available.");

    const map = {};
    stocks.forEach(s => map[s.product] = (map[s.product] || 0) + 1);

    let desc = "";
    for (const p in map) desc += `📦 **${p}** → ${map[p]}\n`;

    await interaction.editReply({
      embeds: [createEmbed().setTitle("📊 Stock Count").setDescription(desc)]
    });
  }

  /* ---------- BUTTONS ---------- */
  if (interaction.isButton()) {

    /* ⭐ REVIEW BUTTON */
    if (interaction.customId === "leave_review") {
      const modal = new ModalBuilder()
        .setCustomId("review_modal")
        .setTitle("⭐ Leave a Review");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("rating")
            .setLabel("Rating (1-5)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("comment")
            .setLabel("Your feedback")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    if (!interaction.member.roles.cache.has(config.adminRoleID))
      return interaction.reply({ content: "❌ Admin only.", ephemeral: true });

    const [action, orderId] = interaction.customId.split("_");
    const order = await Orders.findOne({ orderId });

    if (!order || order.status !== "pending")
      return interaction.reply({ content: "❌ Already processed.", ephemeral: true });

    /* ---------- REJECT ---------- */
    if (action === "reject") {
      order.status = "rejected";
      await order.save();
      return interaction.update({ content: "❌ Order rejected", components: [] });
    }

    /* ---------- APPROVE ---------- */
    if (action === "approve") {
      const stock = await Stock.findOne({ product: order.product, used: false });
      if (!stock) return interaction.reply({ content: "❌ No stock.", ephemeral: true });

      stock.used = true;
      await stock.save();

      order.status = "completed";
      await order.save();

      const user = await client.users.fetch(order.userId);

      const deliveryEmbed = createEmbed()
        .setTitle("🎉 DELIVERY SUCCESSFUL")
        .setDescription(
          `📦 **Product:** ${order.product}\n` +
          `🆔 **Order ID:** \`${order.orderId}\`\n\n` +
          "🔐 **Your Item:**\n||```text\n" + stock.data + "\n```||"
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("⭐ Leave Review").setCustomId("leave_review").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setLabel("🆘 Support").setStyle(ButtonStyle.Link).setURL(BRAND.supportUrl)
      );

      await user.send({ embeds: [deliveryEmbed], components: [row] }).catch(() => {});
      return interaction.update({ content: "✅ Delivered", components: [] });
    }
  }

  /* ---------- REVIEW MODAL ---------- */
  if (interaction.isModalSubmit() && interaction.customId === "review_modal") {
    const rating = interaction.fields.getTextInputValue("rating");
    const comment = interaction.fields.getTextInputValue("comment");

    const reviewEmbed = createEmbed()
      .setTitle("⭐ New Customer Review")
      .addFields(
        { name: "👤 User", value: `<@${interaction.user.id}>`, inline: true },
        { name: "⭐ Rating", value: rating + "/5", inline: true },
        { name: "💬 Review", value: comment }
      );

    const logChannel = client.channels.cache.get(config.logChannelID);
    if (logChannel) logChannel.send({ embeds: [reviewEmbed] });

    await interaction.reply({ content: "✅ Thanks for your review!", ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
