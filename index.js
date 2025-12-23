// =====================
// IMPORTS
// =====================
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes
} = require("discord.js");
const mongoose = require("mongoose");

// =====================
// CONFIG (EDIT VALUES ONLY)
// =====================
const CONFIG = {
  DISCORD_TOKEN: "5c6c9e6323ec93e4f393e79aa6c4f3b7387bd9a974acf7d1c16ec868eeb5bd75",
  CLIENT_ID: "1452604899505209365",
  GUILD_ID: "1429867009537212580",
  ADMIN_ROLE_ID: "1451213671014469653",
  ADMIN_CHANNEL_ID: "1446852742361514118",
  MONGO_URI: "mongodb+srv://Shreyas:shreyas234@discordautopaybot.8z4zciy.mongodb.net/discordbot?appName=discordautopaybot"
};

// =====================
// CLIENT SETUP
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// =====================
// DATABASE MODELS
// =====================
const Stock = mongoose.model(
  "Stock",
  new mongoose.Schema({
    product: String,
    data: String,
    used: { type: Boolean, default: false }
  })
);

const Order = mongoose.model(
  "Order",
  new mongoose.Schema({
    orderId: String,
    userId: String,
    product: String,
    status: String // pending | approved | rejected
  })
);

// =====================
// SLASH COMMANDS (BUILDER STYLE)
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("addstock")
    .setDescription("Add stock (admin only)")
    .addStringOption(o =>
      o.setName("product").setDescription("Product name").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("data").setDescription("Code / account").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy a product")
    .addStringOption(o =>
      o.setName("product").setDescription("Product name").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("stockcount")
    .setDescription("📦 View remaining stock")
].map(cmd => cmd.toJSON());

// =====================
// REGISTER SLASH COMMANDS
// =====================
const rest = new REST({ version: "10" }).setToken(CONFIG.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
    { body: commands }
  );
  console.log("✅ Slash commands registered");
})();

// =====================
// MONGODB CONNECT
// =====================
mongoose
  .connect(CONFIG.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("MongoDB Error:", err));

// =====================
// READY
// =====================
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async interaction => {

  // =====================
  // SLASH COMMANDS
  // =====================
  if (interaction.isChatInputCommand()) {

    // /addstock
    if (interaction.commandName === "addstock") {
      if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) {
        return interaction.reply({ content: "❌ Admin only", ephemeral: true });
      }

      await Stock.create({
        product: interaction.options.getString("product"),
        data: interaction.options.getString("data")
      });

      return interaction.reply("✅ Stock added successfully");
    }

    // /buy
    if (interaction.commandName === "buy") {
      const orderId = `ORD-${Date.now()}`;

      await Order.create({
        orderId,
        userId: interaction.user.id,
        product: interaction.options.getString("product"),
        status: "pending"
      });

      const embed = new EmbedBuilder()
        .setTitle("🛒 New Purchase Request")
        .addFields(
          { name: "User", value: interaction.user.tag },
          { name: "Product", value: interaction.options.getString("product") },
          { name: "Order ID", value: orderId }
        )
        .setColor(0xffcc00);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${orderId}`)
          .setLabel("✅ Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_${orderId}`)
          .setLabel("❌ Reject")
          .setStyle(ButtonStyle.Danger)
      );

      const adminChannel = await client.channels.fetch(CONFIG.ADMIN_CHANNEL_ID);
      await adminChannel.send({ embeds: [embed], components: [buttons] });

      return interaction.reply({
        content: "🕒 Order sent for admin approval",
        ephemeral: true
      });
    }

    // /stockcount
    if (interaction.commandName === "stockcount") {
      const stocks = await Stock.find({ used: false });
      if (!stocks.length) {
        return interaction.reply({
          content: "❌ No stock available",
          ephemeral: true
        });
      }

      const counts = {};
      stocks.forEach(s => {
        counts[s.product] = (counts[s.product] || 0) + 1;
      });

      let text = "";
      for (const p in counts) {
        text += `📦 **${p}** → ${counts[p]} remaining\n`;
      }

      const embed = new EmbedBuilder()
        .setTitle("📊 Stock Count")
        .setDescription(text)
        .setColor(0x00ff99);

      return interaction.reply({ embeds: [embed] });
    }
  }

  // =====================
  // BUTTON INTERACTIONS
  // =====================
  if (interaction.isButton()) {

    // APPROVE ORDER
    if (interaction.customId.startsWith("approve_")) {
      if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) {
        return interaction.reply({ content: "❌ Admin only", ephemeral: true });
      }

      const orderId = interaction.customId.split("_")[1];
      const order = await Order.findOne({ orderId });
      if (!order) return;

      const stock = await Stock.findOne({
        product: order.product,
        used: false
      });

      if (!stock) {
        return interaction.reply({
          content: "❌ No stock available",
          ephemeral: true
        });
      }

      stock.used = true;
      await stock.save();

      order.status = "approved";
      await order.save();

      const user = await client.users.fetch(order.userId);

      const embed = new EmbedBuilder()
        .setTitle("🎁 Pʀᴏᴅᴜᴄᴛ Dᴇʟɪᴠᴇʀᴇᴅ Sᴜᴄᴄᴇssғᴜʟʟʏ")
        .addFields(
          { name: "Product", value: order.product },
          { name: "Order ID", value: order.orderId },
          { name: "🔒 Your Code", value: "```••••••••••```" }
        )
        .setColor(0x00ff99);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reveal_${order.orderId}`)
          .setLabel("👁️ Reveal Code")
          .setStyle(ButtonStyle.Primary)
      );

      await user.send({ embeds: [embed], components: [row] });
      return interaction.update({ content: "✅ Order approved", components: [] });
    }

    // REJECT ORDER
    if (interaction.customId.startsWith("reject_")) {
      return interaction.update({
        content: "❌ Order rejected",
        components: []
      });
    }

    // REVEAL CODE
    if (interaction.customId.startsWith("reveal_")) {
      const orderId = interaction.customId.split("_")[1];
      const order = await Order.findOne({ orderId });

      if (!order || interaction.user.id !== order.userId) {
        return interaction.reply({
          content: "❌ Not allowed",
          ephemeral: true
        });
      }

      const stock = await Stock.findOne({
        product: order.product,
        used: true
      }).sort({ _id: -1 });

      const embed = new EmbedBuilder()
        .setTitle("🔓 Code Revealed")
        .setDescription(`\`\`\`${stock.data}\`\`\``)
        .setColor(0x00ff99);

      return interaction.update({ embeds: [embed], components: [] });
    }
  }
});

// =====================
// LOGIN
// =====================
client.login(CONFIG.DISCORD_TOKEN);
