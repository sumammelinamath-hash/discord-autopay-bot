const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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

/* ================= MONGODB CONNECT ================= */
mongoose
  .connect(config.mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));

/* ================= BOT READY ================= */
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
    if (adminChannel) {
      adminChannel.send({ embeds: [adminEmbed], components: [buttons] });
    }

    await interaction.editReply({
      embeds: [
        createEmbed()
          .setTitle("✅ Order Submitted")
          .setDescription("Your request has been sent.\n⏳ Waiting for admin approval.")
          .addFields(
            { name: "📦 Product", value: product, inline: true },
            { name: "🆔 Order ID", value: orderId, inline: true },
            { name: "📊 Status", value: "Pending", inline: true }
          )
      ]
    });
  }

  /* ---------- /addstock ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === "addstock") {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member.roles.cache.has(config.adminRoleID)) {
      return interaction.editReply("❌ Admin only command.");
    }

    await Stock.create({
      product: interaction.options.getString("product"),
      data: interaction.options.getString("data"),
      used: false
    });

    await interaction.editReply({
      embeds: [
        createEmbed()
          .setTitle("✅ Stock Added")
          .setDescription("Stock successfully added and ready for delivery.")
      ]
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
      embeds: [
        createEmbed()
          .setTitle("📊 Live Stock Inventory")
          .setDescription(desc)
      ]
    });
  }

  /* ---------- BUTTON HANDLER ---------- */
  if (interaction.isButton()) {

    if (!interaction.member.roles.cache.has(config.adminRoleID)) {
      return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
    }

    const [action, orderId] = interaction.customId.split("_");
    const order = await Orders.findOne({ orderId });
    if (!order || order.status !== "pending") {
      return interaction.reply({ content: "❌ Order already processed.", ephemeral: true });
    }

    /* ---------- REJECT ---------- */
    if (action === "reject") {
      order.status = "rejected";
      await order.save();

      const user = await client.users.fetch(order.userId);
      user.send("❌ Your order was rejected.").catch(() => {});

      return interaction.update({ content: "❌ Order rejected", components: [] });
    }

    /* ---------- APPROVE (OPTION 2 DELIVERY) ---------- */
    if (action === "approve") {

      const stock = await Stock.findOne({ product: order.product, used: false });
      if (!stock) return interaction.reply({ content: "❌ No stock available.", ephemeral: true });

      stock.used = true;
      await stock.save();

      order.status = "completed";
      await order.save();

      const user = await client.users.fetch(order.userId);

      // 💎 ULTRA PREMIUM DELIVERY DM
      const deliveryEmbed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setAuthor({ name: `${BRAND.name} • Secure Delivery`, iconURL: BRAND.logo })
        .setTitle("🎉 DELIVERY SUCCESSFUL")
        .setDescription(
          "━━━━━━━━━━━━━━━━━━━━━━\n" +
          "✨ **THANK YOU FOR YOUR PURCHASE** ✨\n" +
          "━━━━━━━━━━━━━━━━━━━━━━\n\n" +
          `📦 **Product:** ${order.product}\n` +
          `🆔 **Order ID:** \`${order.orderId}\`\n\n` +
          "🔐 **Your Secure Item:**\n" +
          "||```text\n" +
          stock.data +
          "\n```||\n\n" +
          "⚠️ Do not share this with anyone."
        )
        .setThumbnail(BRAND.logo)
        .setFooter({ text: BRAND.footer })
        .setTimestamp();

      const dmButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("📋 Copy (Manual)")
          .setStyle(ButtonStyle.Secondary)
          .setCustomId("copy_disabled"),
        new ButtonBuilder()
          .setLabel("🆘 Support")
          .setStyle(ButtonStyle.Link)
          .setURL(BRAND.supportUrl)
      );

      await user.send({ embeds: [deliveryEmbed], components: [dmButtons] }).catch(() => {});

      const logChannel = client.channels.cache.get(config.logChannelID);
      if (logChannel) logChannel.send({ embeds: [deliveryEmbed] });

      return interaction.update({ content: "✅ Order approved & delivered", components: [] });
    }
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
