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
  TextInputStyle,
  StringSelectMenuBuilder,
  ActivityType
} = require("discord.js");

const mongoose = require("mongoose");
const config = require("./config");
const Stock = require("./models/Stock");
const Orders = require("./models/Orders");

/* ================= BRAND ================= */
const BRAND = config.brand;

/* Animated Emojis (you can replace with your server emojis) */
const EMOJIS = {
  loading: "✨",
  success: "✅",
  cart: "🛒",
  star: "⭐",
  fire: "🔥",
  support: "🆘"
};

function createEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor({ name: `${BRAND.name} ${EMOJIS.fire}`, iconURL: BRAND.logo })
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

  /* 🔄 Animated Status */
  const statuses = [
    { name: "MineCom Store 🛒", type: ActivityType.Watching },
    { name: "Instant Auto Delivery ⚡", type: ActivityType.Playing },
    { name: "Secure Orders 🔐", type: ActivityType.Watching }
  ];

  let i = 0;
  setInterval(() => {
    client.user.setActivity(statuses[i]);
    i = (i + 1) % statuses.length;
  }, 8000);

  /* Slash Commands */
  await client.application.commands.set([
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Open MineCom Store panel"),

    new SlashCommandBuilder()
      .setName("request")
      .setDescription("Request a product"),

    new SlashCommandBuilder()
      .setName("addstock")
      .setDescription("Add stock (Admin only)")
      .addStringOption(o =>
        o.setName("product").setDescription("Product name").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("data").setDescription("Account / Gift code").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("stockcount")
      .setDescription("View available stock count"),

    new SlashCommandBuilder()
      .setName("myorders")
      .setDescription("View your order history")
  ]);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {

  /* ================= PANEL ================= */
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    const panelEmbed = createEmbed()
      .setTitle(`${EMOJIS.cart} MineCom Premium Store`)
      .setDescription(
        "**Fast • Secure • Automatic Delivery**\n\n" +
        "🟢 Instant product delivery\n" +
        "🟢 Trusted & verified stock\n" +
        "🟢 24/7 support\n\n" +
        "**Click below to continue 👇**"
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("open_request").setLabel("🛒 Request Product").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setLabel("🆘 Support").setStyle(ButtonStyle.Link).setURL(BRAND.supportUrl),
      new ButtonBuilder().setCustomId("booster").setLabel("💎 Booster Perks").setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ embeds: [panelEmbed], components: [row] });
  }

  /* ================= BUTTONS ================= */
  if (interaction.isButton()) {

    /* ---------- OPEN REQUEST (DROPDOWN) ---------- */
    if (interaction.customId === "open_request") {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("select_product")
        .setPlaceholder("🛒 Select a product")
        .addOptions([
          { label: "Minecraft Premium", value: "Minecraft Premium", emoji: "🎮" },
          { label: "Crunchyroll Premium", value: "Crunchyroll Premium", emoji: "🍿" },
          { label: "Netflix Premium", value: "Netflix Premium", emoji: "🎬" }
        ]);

      return interaction.reply({
        embeds: [createEmbed().setTitle("🛒 Choose Product")],
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    /* ---------- BOOSTER ---------- */
    if (interaction.customId === "booster") {
      return interaction.reply({
        embeds: [
          createEmbed()
            .setTitle("💎 Booster Benefits")
            .setDescription("Thank you for boosting!\nPerks are applied automatically ❤️")
        ],
        ephemeral: true
      });
    }

    /* ---------- REVIEW BUTTON ---------- */
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

    /* ---------- ADMIN BUTTONS ---------- */
    if (!interaction.member.roles.cache.has(config.adminRoleID))
      return interaction.reply({ content: "❌ Admin only.", ephemeral: true });

    const [action, orderId] = interaction.customId.split("_");
    const order = await Orders.findOne({ orderId });
    if (!order || order.status !== "pending")
      return interaction.reply({ content: "❌ Already processed.", ephemeral: true });

    if (action === "reject") {
      order.status = "rejected";
      await order.save();
      return interaction.update({ content: "❌ Order rejected", components: [] });
    }

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
        new ButtonBuilder().setCustomId("leave_review").setLabel("⭐ Leave Review").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setLabel("🆘 Support").setStyle(ButtonStyle.Link).setURL(BRAND.supportUrl)
      );

      await user.send({ embeds: [deliveryEmbed], components: [row] }).catch(() => {});
      return interaction.update({ content: "✅ Delivered", components: [] });
    }
  }

  /* ================= SELECT MENU ================= */
  if (interaction.isStringSelectMenu() && interaction.customId === "select_product") {
    const product = interaction.values[0];
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

    return interaction.update({
      embeds: [createEmbed().setTitle("✅ Order Submitted").setDescription("Waiting for admin approval ⏳")],
      components: []
    });
  }

  /* ================= MY ORDERS ================= */
  if (interaction.isChatInputCommand() && interaction.commandName === "myorders") {
    const orders = await Orders.find({ userId: interaction.user.id }).sort({ createdAt: -1 }).limit(10);
    if (!orders.length)
      return interaction.reply({ content: "❌ No orders found.", ephemeral: true });

    let desc = "";
    orders.forEach(o => {
      desc += `🆔 **${o.orderId}** | 📦 ${o.product} | 🟢 ${o.status}\n`;
    });

    return interaction.reply({
      embeds: [createEmbed().setTitle("📜 Your Orders").setDescription(desc)],
      ephemeral: true
    });
  }

  /* ================= REVIEW MODAL ================= */
  if (interaction.isModalSubmit() && interaction.customId === "review_modal") {
    const rating = interaction.fields.getTextInputValue("rating");
    const comment = interaction.fields.getTextInputValue("comment");

    const reviewEmbed = createEmbed()
      .setTitle("⭐ New Review")
      .addFields(
        { name: "👤 User", value: `<@${interaction.user.id}>`, inline: true },
        { name: "⭐ Rating", value: `${rating}/5`, inline: true },
        { name: "💬 Review", value: comment }
      );

    const logChannel = client.channels.cache.get(config.logChannelID);
    if (logChannel) logChannel.send({ embeds: [reviewEmbed] });

    return interaction.reply({ content: "✅ Thank you for your review!", ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
