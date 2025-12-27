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
const EMOJIS = { cart: "<a:AddToCart:1454454014467903593>", fire: "<a:fire20:1454459210463973442>", star: "<a:star_op:1454459667173478552>", support: ":sos:" };

const createEmbed = (title, description) => {
  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor({ name: `${BRAND.name} ${EMOJIS.fire}`, iconURL: BRAND.logo })
    .setFooter({ text: BRAND.footer, iconURL: BRAND.logo })
    .setTimestamp();
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
};

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: ["CHANNEL"]
});

/* ================= MONGODB ================= */
if (!config.mongoURI) {
  console.error("❌ MongoDB URI missing!");
  process.exit(1);
}

mongoose.connect(config.mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB Error:", err);
    process.exit(1);
  });

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

  // Register Slash Commands
  await client.application.commands.set([
    new SlashCommandBuilder().setName("panel").setDescription("Open store panel"),
    new SlashCommandBuilder()
      .setName("addstock")
      .setDescription("Add stock (Admin)")
      .addStringOption(o => o.setName("product").setDescription("Product name").setRequired(true))
      .addStringOption(o => o.setName("data").setDescription("Code / Account").setRequired(true)),
    new SlashCommandBuilder()
      .setName("importstock")
      .setDescription("Import stock via TXT (Admin)")
      .addStringOption(o => o.setName("product").setDescription("Product name").setRequired(true))
      .addAttachmentOption(o => o.setName("file").setDescription(".txt file").setRequired(true)),
    new SlashCommandBuilder().setName("stockcount").setDescription("View stock"),
    new SlashCommandBuilder().setName("myorders").setDescription("Your orders")
  ]);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  try {
    /* ---------- PANEL ---------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
  return interaction.reply({
    embeds: [
      createEmbed()
        .setTitle("<a:cartspin:1454454014467903553>MineCom Store")
        .setDescription(
          "<a:zapp:1454475841257078986>Fast Delivery\n" +
          "<a:locked:1454475798714126477>Secure & Trusted"
        )
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("open_request")
          .setLabel("Request")
          .setEmoji("1454454014467903553") // ✅ ONLY ID
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setLabel("Support")
          .setStyle(ButtonStyle.Link)
          .setURL(BRAND.supportUrl)
      )
    ]
  });
    }

    /* ---------- ADD STOCK ---------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "addstock") {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.editReply("❌ Admin only");

      const product = interaction.options.getString("product");
      const data = interaction.options.getString("data");

      if (!product || !data) return interaction.editReply("❌ Product or Data missing");

      await Stock.create({ product, data, used: false });
      return interaction.editReply("✅ Stock added");
    }

    /* ---------- IMPORT STOCK ---------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "importstock") {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.editReply("❌ Admin only");

      const product = interaction.options.getString("product");
      const file = interaction.options.getAttachment("file");
      if (!file?.name.endsWith(".txt")) return interaction.editReply("❌ Only .txt files allowed");

      const text = await (await fetch(file.url)).text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

      for (const line of lines) await Stock.create({ product, data: line, used: false });
      return interaction.editReply(`✅ Imported ${lines.length} stocks`);
    }

    /* ---------- STOCK COUNT ---------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "stockcount") {
      const stocks = await Stock.find({ used: false });
      if (!stocks.length) return interaction.reply({ content: "❌ No stock", ephemeral: true });

      const map = {};
      stocks.forEach(s => map[s.product] = (map[s.product] || 0) + 1);
      const desc = Object.entries(map).map(([p, n]) => `📦 **${p}** → ${n}`).join("\n");

      return interaction.reply({ embeds: [createEmbed("📊 Stock Count", desc)], ephemeral: true });
    }

    /* ---------- MY ORDERS ---------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "myorders") {
      const orders = await Orders.find({ userId: interaction.user.id });
      if (!orders.length) return interaction.reply({ content: "❌ No orders", ephemeral: true });

      const desc = orders.map(o => `🆔 ${o.orderId} • ${o.product} • ${o.status}`).join("\n");
      return interaction.reply({ embeds: [createEmbed("🧾 Your Orders", desc)], ephemeral: true });
    }

    /* ---------- REQUEST BUTTON ---------- */
    if (interaction.isButton() && interaction.customId === "open_request") {
      return interaction.reply({
        embeds: [createEmbed("🛒 Select Product")],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("select_product")
            .setPlaceholder("Choose product")
            .addOptions(
  { label: "Minecraft Premium", value: "Minecraft Premium", emoji: ":console:" },

  { label: "Minecraft Donut Unban", value: "Minecraft Donut Unban", emoji: "🍩" },
  { label: "Minecraft Redeem Code (Method)", value: "Minecraft Redeem Code (Method)", emoji: "🧾" },
  { label: "Minecraft Premium (Own Pass)", value: "Minecraft Premium (Own Pass)", emoji: "🔐" },

  { label: "Roblox $50 Gift Card (Method)", value: "Roblox $50 Gift Card (Method)", emoji: ":gift:" },
  { label: "Roblox $100 Gift Card (Method)", value: "Roblox $100 Gift Card (Method)", emoji: "💎" },

  { label: "Nitro Basic (Method)", value: "Nitro Basic (Method)", emoji: "⚡" },
  { label: "Nitro Boost (Method)", value: "Nitro Boost (Method)", emoji: "🚀" },

  { label: "MCFA (3 Months)", value: "MCFA (3 Months)", emoji: "🛡️" }
)
        )],
        ephemeral: true
      });
    }

    /* ---------- SELECT PRODUCT ---------- */
    if (interaction.isStringSelectMenu() && interaction.customId === "select_product") {
      await interaction.deferUpdate();

      const product = interaction.values[0];
      if (!product) return;

      const orderId = `ORD-${Date.now()}`;
      await Orders.create({ orderId, userId: interaction.user.id, product, status: "pending" });

      const adminChannel = client.channels.cache.get(config.adminChannelID);
      adminChannel?.send({
        embeds: [createEmbed("🛒 New Order").addFields(
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

    /* ---------- APPROVE / REJECT ---------- */
    if (interaction.isButton() && (interaction.customId.startsWith("approve_") || interaction.customId.startsWith("reject_"))) {
      await interaction.deferUpdate();
      if (!interaction.member.roles.cache.has(config.adminRoleID)) return;

      const [action, orderId] = interaction.customId.split("_");
      const order = await Orders.findOne({ orderId });
      if (!order || order.status !== "pending") return;

      if (action === "reject") {
        order.status = "rejected";
        await order.save();
        return interaction.editReply({ content: "❌ Order rejected", components: [] });
      }

      const stock = await Stock.findOne({ product: order.product, used: false });
      if (!stock) return interaction.editReply({ content: "❌ No stock", components: [] });

      stock.used = true;
      order.status = "completed";
      await stock.save();
      await order.save();

      const user = await client.users.fetch(order.userId).catch(() => null);
      if (user) {
        await user.send({
          embeds: [createEmbed("🎉 DELIVERY SUCCESSFUL", `📦 **${order.product}**\n\n||\`\`\`\n${stock.data}\n\`\`\`||`)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vouch_${orderId}`).setLabel("⭐ Leave a Review").setStyle(ButtonStyle.Primary)
          )]
        }).catch(() => {});
      }

      return interaction.editReply({ content: "✅ Delivered", components: [] });
    }

    /* ---------- VOUCH MODAL ---------- */
    if (interaction.isButton() && interaction.customId.startsWith("vouch_")) {
      const orderId = interaction.customId.split("_")[1];
      return interaction.showModal(
        new ModalBuilder().setCustomId(`vouch_modal_${orderId}`).setTitle("⭐ Leave a Review")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("rating").setLabel("Rating (1-5)").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("message").setLabel("Your Review").setStyle(TextInputStyle.Paragraph).setRequired(true)
            )
          )
      );
    }

    /* ---------- VOUCH SUBMIT ---------- */
    if (interaction.isModalSubmit() && interaction.customId.startsWith("vouch_modal_")) {
      await interaction.deferReply({ ephemeral: true });

      const orderId = interaction.customId.split("_")[2];
      if (await Vouch.findOne({ orderId })) return interaction.editReply("❌ Already reviewed");

      const rating = Number(interaction.fields.getTextInputValue("rating"));
      const message = interaction.fields.getTextInputValue("message");

      await Vouch.create({ orderId, userId: interaction.user.id, rating, message });

      client.channels.cache.get(config.vouchChannelID)?.send({
        embeds: [createEmbed("🌟 New Review", `⭐`.repeat(Math.min(Math.max(rating, 1), 5)) + `\n\n${message}\n👤 <@${interaction.user.id}>`)]
      });

      return interaction.editReply("✅ Thanks for your review!");
    }

  } catch (err) {
    console.error("❌ Interaction Error:", err);
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply("❌ An error occurred. Check bot logs.");
    } else {
      return interaction.reply({ content: "❌ An error occurred. Check bot logs.", ephemeral: true });
    }
  }
});

/* ================= LOGIN ================= */
if (!config.token) {
  console.error("❌ Bot token missing!");
  process.exit(1);
}

client.login(config.token);
