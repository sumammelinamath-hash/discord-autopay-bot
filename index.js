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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages
  ]
});

/* -------------------- MONGODB CONNECT -------------------- */
mongoose
  .connect(config.mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log(err));

/* -------------------- BOT READY -------------------- */
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  await client.application.commands.set([
    new SlashCommandBuilder()
      .setName("buy")
      .setDescription("Request a product")
      .addStringOption(option =>
        option
          .setName("product")
          .setDescription("minecraft / crunchyroll")
          .setRequired(true)
      )
  ]);
});

/* -------------------- INTERACTIONS -------------------- */
client.on("interactionCreate", async interaction => {

  /* ----------- /buy COMMAND ----------- */
  if (interaction.isChatInputCommand() && interaction.commandName === "buy") {
    const product = interaction.options.getString("product");
    const orderId = `ORD-${Date.now()}`;

    await Orders.create({
      orderId: orderId,
      userId: interaction.user.id,
      product: product,
      status: "pending"
    });

    const embed = new EmbedBuilder()
      .setTitle("🛒 New Order Request")
      .setColor(0x00ff99)
      .addFields(
        { name: "User", value: `<@${interaction.user.id}>` },
        { name: "Product", value: product },
        { name: "Order ID", value: orderId }
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
      adminChannel.send({ embeds: [embed], components: [buttons] });
    }

    await interaction.reply({
      content: `✅ **Order Created**\nOrder ID: **${orderId}**\nPlease wait for admin approval.`,
      ephemeral: true
    });
  }

  /* ----------- BUTTON HANDLER ----------- */
  if (interaction.isButton()) {

    // Admin check
    if (!interaction.member.roles.cache.has(config.adminRoleID)) {
      return interaction.reply({
        content: "❌ You are not allowed to do this.",
        ephemeral: true
      });
    }

    const [action, orderId] = interaction.customId.split("_");
    const order = await Orders.findOne({ orderId: orderId });

    if (!order || order.status !== "pending") {
      return interaction.reply({
        content: "❌ This order is invalid or already processed.",
        ephemeral: true
      });
    }

    /* ----------- REJECT ORDER ----------- */
    if (action === "reject") {
      order.status = "rejected";
      await order.save();

      const user = await client.users.fetch(order.userId);
      user.send(`❌ Your **${order.product}** order has been rejected.`)
        .catch(() => {});

      return interaction.update({
        content: "❌ Order Rejected",
        embeds: [],
        components: []
      });
    }

    /* ----------- APPROVE ORDER ----------- */
    if (action === "approve") {
      const stock = await Stock.findOne({
        product: order.product,
        used: false
      });

      if (!stock) {
        return interaction.reply({
          content: "❌ No stock available.",
          ephemeral: true
        });
      }

      stock.used = true;
      await stock.save();

      order.status = "completed";
      await order.save();

      const user = await client.users.fetch(order.userId);
      await user.send(
        `🎁 **Your ${order.product} delivery**\n\n${stock.data}`
      ).catch(() => {});

      const logChannel = client.channels.cache.get(config.logChannelID);
      if (logChannel) {
        logChannel.send(
          `✅ **${order.product} delivered** to <@${order.userId}>`
        );
      }

      return interaction.update({
        content: "✅ Order Approved & Delivered",
        embeds: [],
        components: []
      });
    }
  }
});

/* -------------------- LOGIN -------------------- */
client.login(config.token);
