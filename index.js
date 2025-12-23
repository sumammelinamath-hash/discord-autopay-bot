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

    // 🔄 RENAMED COMMAND
    new SlashCommandBuilder()
      .setName("request")
      .setDescription("Request a product")
      .addStringOption(option =>
        option
          .setName("product")
          .setDescription("minecraft / crunchyroll")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("addstock")
      .setDescription("Add stock (Admin only)")
      .addStringOption(option =>
        option
          .setName("product")
          .setDescription("minecraft / crunchyroll")
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName("data")
          .setDescription("Gift code or account")
          .setRequired(true)
      ),

    // 🆕 STOCK COUNT
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

    try {
      const product = interaction.options.getString("product");
      const orderId = `ORD-${Date.now()}`;

      await Orders.create({
        orderId,
        userId: interaction.user.id,
        product,
        status: "pending"
      });

      const embed = new EmbedBuilder()
        .setTitle("🛒 New Order Request")
        .setColor(0x00ff99)
        .addFields(
          { name: "👤 User", value: `<@${interaction.user.id}>` },
          { name: "📦 Product", value: product },
          { name: "🆔 Order ID", value: orderId }
        )
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${orderId}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_${orderId}`)
          .setLabel("Reject")
          .setStyle(ButtonStyle.Danger)
      );

      const adminChannel = client.channels.cache.get(config.adminChannelID);
      if (adminChannel) {
        await adminChannel.send({ embeds: [embed], components: [buttons] });
      }

      await interaction.editReply(
        `✅ Order created!\n🆔 **Order ID:** \`${orderId}\`\n⏳ Waiting for admin approval.`
      );

    } catch (err) {
      console.log(err);
      await interaction.editReply("❌ Something went wrong.");
    }
  }

  /* ---------- /addstock ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === "addstock") {

    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member.roles.cache.has(config.adminRoleID)) {
      return interaction.editReply("❌ Admin only command.");
    }

    try {
      const product = interaction.options.getString("product");
      const data = interaction.options.getString("data");

      await Stock.create({
        product,
        data,
        used: false
      });

      await interaction.editReply(`✅ Stock added for **${product}**`);

    } catch (err) {
      console.log(err);
      await interaction.editReply("❌ Failed to add stock.");
    }
  }

  /* ---------- /stockcount ---------- */
  if (interaction.isChatInputCommand() && interaction.commandName === "stockcount") {

    await interaction.deferReply({ ephemeral: true });

    try {
      const stocks = await Stock.find({ used: false });

      if (!stocks.length) {
        return interaction.editReply("❌ No stock available.");
      }

      const map = {};
      stocks.forEach(s => {
        map[s.product] = (map[s.product] || 0) + 1;
      });

      let desc = "";
      for (const p in map) {
        desc += `📦 **${p}** → ${map[p]}\n`;
      }

      const embed = new EmbedBuilder()
        .setTitle("📊 Stock Count")
        .setColor(0x0099ff)
        .setDescription(desc);

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.log(err);
      await interaction.editReply("❌ Failed to fetch stock.");
    }
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

    /* ----- REJECT ----- */
    if (action === "reject") {
      order.status = "rejected";
      await order.save();

      const user = await client.users.fetch(order.userId);
      user.send(`❌ Your **${order.product}** order was rejected.`).catch(() => {});

      return interaction.update({ content: "❌ Order rejected", embeds: [], components: [] });
    }

    /* ----- APPROVE ----- */
    if (action === "approve") {

      const stock = await Stock.findOne({ product: order.product, used: false });
      if (!stock) {
        return interaction.reply({ content: "❌ No stock available.", ephemeral: true });
      }

      stock.used = true;
      await stock.save();

      order.status = "completed";
      await order.save();

      const user = await client.users.fetch(order.userId);

      // ⭐ BETTER DELIVERY DM
      const dmEmbed = new EmbedBuilder()
        .setTitle("🎁 Order Delivered")
        .setColor(0x00ff99)
        .addFields(
          { name: "📦 Product", value: order.product },
          { name: "🆔 Order ID", value: order.orderId },
          { name: "🔐 Your Item", value: `\`\`\`${stock.data}\`\`\`` }
        )
        .setFooter({ text: "Thank you for your purchase ❤️" })
        .setTimestamp();

      await user.send({ embeds: [dmEmbed] }).catch(() => {});

      const logChannel = client.channels.cache.get(config.logChannelID);
      if (logChannel) {
        logChannel.send(`✅ Delivered **${order.product}** to <@${order.userId}>`);
      }

      return interaction.update({
        content: "✅ Order approved & delivered",
        embeds: [],
        components: []
      });
    }
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
