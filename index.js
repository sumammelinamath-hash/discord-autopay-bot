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

/* ================= EMBED HELPER ================= */
function createEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor({ name: BRAND.name, iconURL: BRAND.logo })
    .setFooter({ text: BRAND.footer, iconURL: BRAND.logo })
    .setTimestamp();
}

/* ================= STAR ANIMATION ================= */
function animatedStars(rating) {
  const star = "⭐";
  const glow = "✨";
  const spark = "🌟";

  let stars = star.repeat(rating);
  let padding = glow.repeat(2);

  return `${spark} ${padding} ${stars} ${padding} ${spark}`;
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
mongoose.connect(config.mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(console.error);

/* ================= READY ================= */
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  client.user.setActivity("MineCom Store 🛒", { type: ActivityType.Watching });

  await client.application.commands.set([
    new SlashCommandBuilder().setName("panel").setDescription("Open store panel")
  ]);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {

  /* ================= PANEL ================= */
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    return interaction.reply({
      embeds: [
        createEmbed()
          .setTitle("🛒 MineCom Premium Store")
          .setDescription(
            "⚡ **Instant Delivery**\n" +
            "🔐 **Secure Payments**\n" +
            "⭐ **Trusted by Customers**"
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("open_request")
            .setLabel("🛒 Request")
            .setStyle(ButtonStyle.Success)
        )
      ]
    });
  }

  /* ================= PRODUCT SELECT ================= */
  if (interaction.isButton() && interaction.customId === "open_request") {
    return interaction.reply({
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("select_product")
            .setPlaceholder("Choose product")
            .addOptions(
              { label: "Minecraft Premium", value: "Minecraft Premium" }
            )
        )
      ],
      ephemeral: true
    });
  }

  /* ================= CREATE ORDER ================= */
  if (interaction.isStringSelectMenu()) {
    const orderId = `ORD-${Date.now()}`;

    await Orders.create({
      orderId,
      userId: interaction.user.id,
      product: interaction.values[0],
      status: "pending"
    });

    return interaction.update({
      content: "✅ Order placed. Waiting for approval.",
      components: []
    });
  }

  /* ================= APPROVE ORDER ================= */
  if (interaction.isButton() && interaction.customId.startsWith("approve_")) {
    const orderId = interaction.customId.split("_")[1];
    const order = await Orders.findOne({ orderId });
    if (!order) return;

    const stock = await Stock.findOne({ product: order.product, used: false });
    if (!stock)
      return interaction.reply({ content: "❌ No stock available", ephemeral: true });

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
            "Here is your product:\n\n" +
            `||\`\`\`\n${stock.data}\n\`\`\`||`
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`leave_review_${orderId}`)
            .setLabel("⭐ Leave a Review")
            .setStyle(ButtonStyle.Primary)
        )
      ]
    });

    return interaction.update({ content: "✅ Delivered successfully", components: [] });
  }

  /* ================= REVIEW BUTTON ================= */
  if (interaction.isButton() && interaction.customId.startsWith("leave_review_")) {
    const orderId = interaction.customId.split("_")[2];

    const modal = new ModalBuilder()
      .setCustomId(`review_modal_${orderId}`)
      .setTitle("⭐ Leave a Review");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("rating")
          .setLabel("Rating (1 to 5)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel("Your Experience")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );

    return interaction.showModal(modal);
  }

  /* ================= REVIEW SUBMIT ================= */
  if (interaction.isModalSubmit() && interaction.customId.startsWith("review_modal_")) {
    const orderId = interaction.customId.split("_")[2];

    if (await Vouch.findOne({ orderId }))
      return interaction.reply({ content: "❌ You already reviewed this order", ephemeral: true });

    const rating = Math.min(5, Math.max(1, Number(interaction.fields.getTextInputValue("rating"))));
    const message = interaction.fields.getTextInputValue("message");

    await Vouch.create({
      orderId,
      userId: interaction.user.id,
      rating,
      message
    });

    const count = await Vouch.countDocuments();
    const stars = animatedStars(rating);

    const vouchChannel = client.channels.cache.get(config.vouchChannelID);

    vouchChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ff99)
          .setTitle("Thank you for another Review!")
          .setDescription(
            `${stars}\n\n` +
            `**Vouch:** ${message}\n\n` +
            `**Vouch No:** ${count}\n` +
            `**Vouched by:** <@${interaction.user.id}>`
          )
          .setFooter({ text: `Service Provided by ${BRAND.name}` })
      ]
    });

    return interaction.reply({ content: "✅ Review submitted successfully!", ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
