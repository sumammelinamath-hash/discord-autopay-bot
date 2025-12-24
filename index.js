const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ActivityType
} = require("discord.js");

const mongoose = require("mongoose");
const config = require("./config");
const Stock = require("./models/Stock");
const Orders = require("./models/Orders");

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

  /* ================= ADD STOCK ================= */
  if (interaction.isChatInputCommand() && interaction.commandName === "addstock") {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member.roles.cache.has(config.adminRoleID))
      return interaction.editReply("❌ Admin only");

    await Stock.create({
      product: interaction.options.getString("product"),
      data: interaction.options.getString("data"),
      used: false
    });

    return interaction.editReply({
      embeds: [createEmbed().setTitle("✅ Stock Added")]
    });
  }

  /* ================= AUTO IMPORT STOCK ================= */
if (interaction.isChatInputCommand() && interaction.commandName === "importstock") {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.member.roles.cache.has(config.adminRoleID))
    return interaction.editReply("❌ Admin only");

  const product = interaction.options.getString("product");
  const attachment = interaction.options.getAttachment("file");

  if (!attachment.name.endsWith(".txt"))
    return interaction.editReply("❌ Only .txt files allowed");

  // Download file content
  const buffer = await attachment.download();
  const text = buffer.toString("utf-8");

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  if (!lines.length)
    return interaction.editReply("❌ File is empty");

  // Prepare bulk insert
  const stocksToInsert = lines.map(line => ({ product, data: line, used: false }));

  // Insert all at once
  await Stock.insertMany(stocksToInsert);

  return interaction.editReply({
    embeds: [
      createEmbed()
        .setTitle("✅ Auto Restock Complete")
        .setDescription(`📦 **Product:** ${product}\n📥 **Imported:** ${lines.length} stocks`)
    ]
  });
    }

  /* ================= STOCK COUNT ================= */
  if (interaction.isChatInputCommand() && interaction.commandName === "stockcount") {
    const stocks = await Stock.find({ used: false });
    if (!stocks.length)
      return interaction.reply({ content: "❌ No stock", ephemeral: true });

    const map = {};
    stocks.forEach(s => (map[s.product] = (map[s.product] || 0) + 1));

    let desc = "";
    for (const p in map) desc += `📦 **${p}** → ${map[p]}\n`;

    return interaction.reply({
      embeds: [createEmbed().setTitle("📊 Stock Count").setDescription(desc)],
      ephemeral: true
    });
  }

  /* ================= APPROVE / REJECT ================= */
  if (interaction.isButton() && interaction.customId.includes("_")) {
    if (!interaction.member.roles.cache.has(config.adminRoleID))
      return interaction.reply({ content: "❌ Admin only", ephemeral: true });

    const [action, orderId] = interaction.customId.split("_");
    const order = await Orders.findOne({ orderId });

    if (!order || order.status !== "pending")
      return interaction.reply({ content: "❌ Already processed", ephemeral: true });

    if (action === "reject") {
      order.status = "rejected";
      await order.save();
      return interaction.update({ content: "❌ Order rejected", components: [] });
    }

    if (action === "approve") {
      const stock = await Stock.findOne({ product: order.product, used: false });
      if (!stock)
        return interaction.reply({ content: "❌ No stock", ephemeral: true });

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
        ]
      });

      return interaction.update({ content: "✅ Delivered", components: [] });
    }
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
