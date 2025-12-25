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
const fetch = require("node-fetch");
const config = require("./config");
const Stock = require("./models/Stock");
const Orders = require("./models/Orders");
const Vouch = require("./models/Vouch");

/* ================= BRAND ================= */
const BRAND = config.brand;
const EMOJIS = { cart: "🛒", fire: "🔥", star: "⭐", support: "🆘" };
const createEmbed = () =>
  new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor({ name: `${BRAND.name} ${EMOJIS.fire}`, iconURL: BRAND.logo })
    .setFooter({ text: BRAND.footer, iconURL: BRAND.logo })
    .setTimestamp();

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ["CHANNEL"]
});

/* ================= MONGODB ================= */
if (!config.mongoURI) {
  console.error("❌ MongoDB URI missing!");
  process.exit(1);
}
mongoose.connect(config.mongoURI, { keepAlive: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => { console.error("❌ MongoDB Error:", err); process.exit(1); });

/* ================= READY ================= */
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  const statuses = [
    { name: "MineCom Store 🛒", type: ActivityType.Watching },
    { name: "Instant Delivery ⚡", type: ActivityType.Playing },
    { name: "Secure Orders 🔐", type: ActivityType.Watching }
  ];

  let i = 0;
  setInterval(() => { client.user.setActivity(statuses[i]); i = (i + 1) % statuses.length; }, 8000);

  await client.application.commands.set([
    new SlashCommandBuilder().setName("panel").setDescription("Open store panel"),
    new SlashCommandBuilder().setName("request").setDescription("Request a product"),
    new SlashCommandBuilder()
      .setName("addstock").setDescription("Add stock (Admin)")
      .addStringOption(o => o.setName("product").setDescription("Product").setRequired(true))
      .addStringOption(o => o.setName("data").setDescription("Code / Account").setRequired(true)),
    new SlashCommandBuilder()
      .setName("importstock").setDescription("Auto restock via TXT file (Admin)")
      .addStringOption(o => o.setName("product").setDescription("Product name").setRequired(true))
      .addAttachmentOption(o => o.setName("file").setDescription("Upload .txt file").setRequired(true)),
    new SlashCommandBuilder().setName("stockcount").setDescription("View stock"),
    new SlashCommandBuilder().setName("myorders").setDescription("Your orders")
  ]);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  try {
    // ---------------- PANEL ----------------
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
      return interaction.reply({
        embeds: [createEmbed().setTitle(`${EMOJIS.cart} MineCom Premium Store`)
          .setDescription("⚡ **Fast Auto Delivery**\n🔐 **Secure & Trusted**\n🆘 **24/7 Support**\n\nClick below 👇")],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("open_request").setLabel("🛒 Request").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setLabel("🆘 Support").setStyle(ButtonStyle.Link).setURL(BRAND.supportUrl)
        )]
      });
    }

    // ---------------- REQUEST BUTTON ----------------
    if (interaction.isButton() && interaction.customId === "open_request") {
      return interaction.reply({
        embeds: [createEmbed().setTitle("🛒 Select Product")],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId("select_product").setPlaceholder("Choose product")
            .addOptions(
              { label: "Minecraft Premium", value: "Minecraft Premium", emoji: "🎮" },
              { label: "Crunchyroll Premium", value: "Crunchyroll Premium", emoji: "🍿" }
            )
        )],
        ephemeral: true
      });
    }

    // ---------------- SELECT MENU ----------------
    if (interaction.isStringSelectMenu() && interaction.customId === "select_product") {
      const product = interaction.values[0];
      const orderId = `ORD-${Date.now()}`;
      await Orders.create({ orderId, userId: interaction.user.id, product, status: "pending" });

      const adminChannel = client.channels.cache.get(config.adminChannelID);
      if (adminChannel) {
        adminChannel.send({
          embeds: [createEmbed().setTitle("🛒 New Order").addFields(
            { name: "User", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Product", value: product, inline: true },
            { name: "Order ID", value: orderId }
          )],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_${orderId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_${orderId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
          )]
        });
      }

      return interaction.update({ embeds: [createEmbed().setTitle("✅ Order Submitted").setDescription("Waiting for approval ⏳")], components: [] });
    }

    // ---------------- ADD STOCK ----------------
    if (interaction.isChatInputCommand() && interaction.commandName === "addstock") {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.guild || !interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.editReply("❌ Admin only");

      await Stock.create({
        product: interaction.options.getString("product"),
        data: interaction.options.getString("data"),
        used: false
      });

      return interaction.editReply({ embeds: [createEmbed().setTitle("✅ Stock Added")] });
    }

    // ---------------- IMPORT STOCK ----------------
    if (interaction.isChatInputCommand() && interaction.commandName === "importstock") {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.guild || !interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.editReply("❌ Admin only");

      const product = interaction.options.getString("product");
      const attachment = interaction.options.getAttachment("file");
      if (!attachment.name.endsWith(".txt")) return interaction.editReply("❌ Only .txt files allowed");

      const text = await (await fetch(attachment.url)).text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) await Stock.create({ product, data: line, used: false });

      return interaction.editReply({
        embeds: [createEmbed().setTitle("✅ Auto Restock Complete")
          .setDescription(`📦 **Product:** ${product}\n📥 **Imported:** ${lines.length} stocks`)]
      });
    }

    // ---------------- STOCK COUNT ----------------
    if (interaction.isChatInputCommand() && interaction.commandName === "stockcount") {
      const stocks = await Stock.find({ used: false });
      if (!stocks.length) return interaction.reply({ content: "❌ No stock", ephemeral: true });

      const map = {};
      stocks.forEach(s => map[s.product] = (map[s.product] || 0) + 1);
      let desc = ""; for (const p in map) desc += `📦 **${p}** → ${map[p]}\n`;

      return interaction.reply({ embeds: [createEmbed().setTitle("📊 Stock Count").setDescription(desc)], ephemeral: true });
    }

    // ---------------- MY ORDERS ----------------
    if (interaction.isChatInputCommand() && interaction.commandName === "myorders") {
      const orders = await Orders.find({ userId: interaction.user.id });
      if (!orders.length) return interaction.reply({ content: "❌ No orders found", ephemeral: true });

      const desc = orders.map(o => `🆔 ${o.orderId} • ${o.product} • ${o.status}`).join("\n");
      return interaction.reply({ embeds: [createEmbed().setTitle("🧾 Your Orders").setDescription(desc)], ephemeral: true });
    }

    // ---------------- APPROVE / REJECT ----------------
    if (interaction.isButton() && (interaction.customId.startsWith("approve_") || interaction.customId.startsWith("reject_"))) {
      if (!interaction.guild || !interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const [action, orderId] = interaction.customId.split("_");
      const order = await Orders.findOne({ orderId });
      if (!order || order.status !== "pending") return interaction.reply({ content: "❌ Already processed", ephemeral: true });

      if (action === "reject") {
        order.status = "rejected"; await order.save();
        return interaction.update({ content: "❌ Order rejected", components: [] });
      }

      if (action === "approve") {
        const stock = await Stock.findOne({ product: order.product, used: false });
        if (!stock) return interaction.reply({ content: "❌ No stock", ephemeral: true });

        stock.used = true; await stock.save();
        order.status = "completed"; await order.save();

        const user = await client.users.fetch(order.userId);
        await user.send({
          embeds: [createEmbed()
            .setTitle("🎉 DELIVERY SUCCESSFUL")
            .setDescription(`📦 **${order.product}**\n🆔 \`${order.orderId}\`\n\n||\`\`\`\n${stock.data}\n\`\`\`||`)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vouch_${orderId}`).setLabel("⭐ Leave a Review").setStyle(ButtonStyle.Primary)
          )]
        });

        return interaction.update({ content: "✅ Delivered", components: [] });
      }
    }

    // ---------------- VOUCH ----------------
    if (interaction.isButton() && interaction.customId.startsWith("vouch_")) {
      const orderId = interaction.customId.split("_")[1];
      const modal = new ModalBuilder().setCustomId(`vouch_modal_${orderId}`).setTitle("⭐ Leave a Review");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("rating").setLabel("Rating (1–5)").setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("message").setLabel("Your Review").setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("vouch_modal_")) {
      const orderId = interaction.customId.split("_")[2];
      if (await Vouch.findOne({ orderId }))
        return interaction.reply({ content: "❌ You already reviewed this order.", ephemeral: true });

      const rating = Number(interaction.fields.getTextInputValue("rating"));
      const message = interaction.fields.getTextInputValue("message");

      await Vouch.create({ orderId, userId: interaction.user.id, rating, message });
      const stars = "✨⭐".repeat(rating);

      const vouchChannel = client.channels.cache.get(config.vouchChannelID);
      if (vouchChannel) {
        vouchChannel.send({
          embeds: [createEmbed().setTitle("🌟 New Customer Review").setDescription(`${stars}\n\n💬 **Review:** ${message}\n👤 **By:** <@${interaction.user.id}>`)]
        });
      }

      return interaction.reply({ content: "✅ Thanks for your review!", ephemeral: true });
    }

  } catch (err) {
    console.error("Interaction Error:", err);
    if (interaction.deferred || interaction.replied)
      return interaction.editReply("❌ An error occurred. Check bot logs.");
    else
      return interaction.reply({ content: "❌ An error occurred. Check bot logs.", ephemeral: true });
  }
});

/* ================= LOGIN ================= */
if (!config.token) { console.error("❌ Bot token missing!"); process.exit(1); }
client.login(config.token);
