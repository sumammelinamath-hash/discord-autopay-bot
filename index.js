const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActivityType
} = require("discord.js");

const mongoose = require("mongoose");
const config = require("./config");
const Stock = require("./models/Stock");
const Orders = require("./models/Orders");
const Vouch = require("./models/Vouch");

/* ================= BRAND ================= */
const BRAND = config.brand;

const EMOJIS = {
  cart: "🛒",
  fire: "🔥",
  star: "⭐",
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
    GatewayIntentBits.GuildMembers,
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

  const statuses = [
    { name: "MineCom Store 🛒", type: ActivityType.Watching },
    { name: "Instant Delivery ⚡", type: ActivityType.Playing },
    { name: "Secure Orders 🔐", type: ActivityType.Watching }
  ];

  let i = 0;
  setInterval(() => {
    client.user.setActivity(statuses[i]);
    i = (i + 1) % statuses.length;
  }, 8000);

  await client.application.commands.set([
    new SlashCommandBuilder().setName("panel").setDescription("Open store panel"),
    new SlashCommandBuilder().setName("request").setDescription("Request a product"),

    new SlashCommandBuilder()
      .setName("addstock")
      .setDescription("Add stock (Admin)")
      .addStringOption(o => o.setName("product").setDescription("Product").setRequired(true))
      .addStringOption(o => o.setName("data").setDescription("Code / Account").setRequired(true)),

    new SlashCommandBuilder()
      .setName("importstock")
      .setDescription("Auto restock via TXT file (Admin)")
      .addStringOption(o => o.setName("product").setDescription("Product name").setRequired(true))
      .addAttachmentOption(o => o.setName("file").setDescription("Upload .txt file").setRequired(true)),

    new SlashCommandBuilder().setName("stockcount").setDescription("View stock"),
    new SlashCommandBuilder().setName("myorders").setDescription("Your orders")
  ]);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {

  /* ================= PANEL ================= */
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    return interaction.reply({
      embeds: [
        createEmbed()
          .setTitle(`${EMOJIS.cart} MineCom Premium Store`)
          .setDescription(
            "⚡ **Fast Auto Delivery**\n" +
            "🔐 **Secure & Trusted**\n" +
            "🆘 **24/7 Support**\n\n" +
            "Click below 👇"
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("open_request").setLabel("🛒 Request").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setLabel("🆘 Support").setStyle(ButtonStyle.Link).setURL(BRAND.supportUrl)
        )
      ]
    });
  }

  /* ================= REQUEST BUTTON ================= */
  if (interaction.isButton() && interaction.customId === "open_request") {
    return interaction.reply({
      embeds: [createEmbed().setTitle("🛒 Select Product")],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("select_product")
            .setPlaceholder("Choose product")
            .addOptions(
              { label: "Minecraft Premium", value: "Minecraft Premium", emoji: "🎮" },
              { label: "Crunchyroll Premium", value: "Crunchyroll Premium", emoji: "🍿" }
            )
        )
      ],
      ephemeral: true
    });
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

    const adminChannel = client.channels.cache.get(config.adminChannelID);
    if (adminChannel) {
      adminChannel.send({
        embeds: [
          createEmbed()
            .setTitle("🛒 New Order")
            .addFields(
              { name: "User", value: `<@${interaction.user.id}>`, inline: true },
              { name: "Product", value: product, inline: true },
              { name: "Order ID", value: orderId }
            )
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_${orderId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_${orderId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
          )
        ]
      });
    }

    return interaction.update({
      embeds: [createEmbed().setTitle("✅ Order Submitted").setDescription("Waiting for approval ⏳")],
      components: []
    });
  }

  /* ================= APPROVE ================= */
  if (interaction.isButton() && interaction.customId.startsWith("approve_")) {
    if (!interaction.member.roles.cache.has(config.adminRoleID))
      return interaction.reply({ content: "❌ Admin only", ephemeral: true });

    const orderId = interaction.customId.split("_")[1];
    const order = await Orders.findOne({ orderId });
    if (!order) return;

    const stock = await Stock.findOne({ product: order.product, used: false });
    if (!stock) return interaction.reply({ content: "❌ No stock", ephemeral: true });

    stock.used = true;
    await stock.save();
    order.status = "completed";
    await order.save();

    const user = await client.users.fetch(order.userId);

    await user.send({
      embeds: [
        createEmbed()
          .setTitle("🎉 DELIVERY SUCCESSFUL")
          .setDescription(
            `📦 **${order.product}**\n🆔 \`${order.orderId}\`\n\n` +
            `||\`\`\`\n${stock.data}\n\`\`\`||`
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`vouch_${orderId}`)
            .setLabel("⭐ Leave a Review")
            .setStyle(ButtonStyle.Primary)
        )
      ]
    });

    return interaction.update({ content: "✅ Delivered", components: [] });
  }

  /* ================= VOUCH BUTTON ================= */
  if (interaction.isButton() && interaction.customId.startsWith("vouch_")) {
    const orderId = interaction.customId.split("_")[1];

    const modal = new ModalBuilder()
      .setCustomId(`vouch_modal_${orderId}`)
      .setTitle("⭐ Leave a Review");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("rating")
          .setLabel("Rating (1–5)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel("Your Review")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );

    return interaction.showModal(modal);
  }

  /* ================= VOUCH SUBMIT ================= */
  if (interaction.isModalSubmit() && interaction.customId.startsWith("vouch_modal_")) {
    const orderId = interaction.customId.split("_")[2];

    if (await Vouch.findOne({ orderId }))
      return interaction.reply({ content: "❌ You already reviewed this order.", ephemeral: true });

    const rating = Number(interaction.fields.getTextInputValue("rating"));
    const message = interaction.fields.getTextInputValue("message");

    await Vouch.create({
      orderId,
      userId: interaction.user.id,
      rating,
      message
    });

    const stars = "✨⭐".repeat(rating);

    const vouchChannel = client.channels.cache.get(config.vouchChannelID);
    if (vouchChannel) {
      vouchChannel.send({
        embeds: [
          createEmbed()
            .setTitle("🌟 New Customer Review")
            .setDescription(
              `${stars}\n\n` +
              `💬 **Review:** ${message}\n` +
              `👤 **By:** <@${interaction.user.id}>`
            )
        ]
      });
    }

    return interaction.reply({ content: "✅ Thanks for your review!", ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
