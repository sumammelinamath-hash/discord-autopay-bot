const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType
} = require("discord.js");

const mongoose = require("mongoose");
const fetch = require("node-fetch");
const config = require("./config");

const Stock = require("./models/Stock");
const Orders = require("./models/Orders");
const Vouch = require("./models/Vouch");
const Invites = require("./models/Invite");

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: ["CHANNEL"]
});

/* ================= INVITE CACHE ================= */
const inviteCache = new Map();

/* ================= BRAND ================= */
const BRAND = config.brand;

/* ================= EMBED ================= */
function createEmbed(title, description) {
  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor({ name: `${BRAND.name} 🔥`, iconURL: BRAND.logo })
    .setFooter({ text: BRAND.footer, iconURL: BRAND.logo })
    .setTimestamp();

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

/* ================= MONGODB ================= */
mongoose.connect(config.mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB Error:", err);
    process.exit(1);
  });

/* ================= READY ================= */
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) continue;
    inviteCache.set(guild.id, new Map(invites.map(i => [i.code, i.uses])));
  }

  client.user.setActivity("MineCom Store 🛒", { type: ActivityType.Watching });

  await client.application.commands.set([
    new SlashCommandBuilder().setName("panel").setDescription("Open store panel"),
    new SlashCommandBuilder().setName("stockcount").setDescription("View stock"),
    new SlashCommandBuilder().setName("myorders").setDescription("Your orders"),

    new SlashCommandBuilder()
      .setName("addstock")
      .setDescription("Add stock (Admin)")
      .addStringOption(o => o.setName("product").setDescription("Product").setRequired(true))
      .addStringOption(o => o.setName("data").setDescription("Data").setRequired(true)),

    new SlashCommandBuilder()
      .setName("importstock")
      .setDescription("Import stock (Admin)")
      .addStringOption(o => o.setName("product").setDescription("Product").setRequired(true))
      .addAttachmentOption(o => o.setName("file").setDescription(".txt file").setRequired(true)),

    new SlashCommandBuilder()
      .setName("resetinvites")
      .setDescription("Reset ALL invites (Admin)"),

    new SlashCommandBuilder()
      .setName("clearinvites")
      .setDescription("Clear invites of a user")
      .addUserOption(o =>
        o.setName("target").setDescription("Select member").setRequired(true)
      )
  ]);
});

/* ================= INVITE TRACKING ================= */
client.on("guildMemberAdd", async member => {
  try {
    const cached = inviteCache.get(member.guild.id) || new Map();
    const invites = await member.guild.invites.fetch();

    let usedInvite;
    for (const inv of invites.values()) {
      if ((cached.get(inv.code) || 0) < inv.uses) {
        usedInvite = inv;
        break;
      }
    }

    inviteCache.set(member.guild.id, new Map(invites.map(i => [i.code, i.uses])));
    if (!usedInvite || !usedInvite.inviter) return;

    const update = {
      $inc: { totalInvites: 1 },
      $setOnInsert: {
        validInvites: 0,
        invitedMembers: [],
        leftMembers: [],
        fakeMembers: []
      }
    };

    if (member.user.bot) {
      update.$addToSet = { fakeMembers: member.id };
    } else {
      update.$inc.validInvites = 1;
      update.$addToSet = { invitedMembers: member.id };
    }

    await Invites.findOneAndUpdate(
      { guildId: member.guild.id, userId: usedInvite.inviter.id },
      update,
      { upsert: true }
    );

  } catch (err) {
    console.error("Invite add error:", err);
  }
});

client.on("guildMemberRemove", async member => {
  try {
    const data = await Invites.findOne({
      guildId: member.guild.id,
      invitedMembers: member.id
    });

    if (!data) return;

    data.validInvites = Math.max((data.validInvites || 1) - 1, 0);
    data.invitedMembers = data.invitedMembers.filter(i => i !== member.id);
    data.leftMembers ??= [];
    data.leftMembers.push(member.id);

    await data.save();
  } catch (err) {
    console.error("Invite remove error:", err);
  }
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  try {

    /* PANEL */
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
      await interaction.deferReply();
      return interaction.editReply({
        embeds: [createEmbed(
          "<a:cart21:1454879646255681558> Mine Premium Store",
          "<a:zapp:1454474883449749626> **Fast Auto Delivery**\n<a:locked20:1454475603754487819> **Secure & Trusted**\n<a:sos20:1454450996653719643> **24/7 Support**"
        )],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("open_request")
              .setLabel("Request")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setLabel("Support")
              .setStyle(ButtonStyle.Link)
              .setURL(BRAND.supportUrl)
          )
        ]
      });
    }

    /* ADD STOCK */
    if (interaction.isChatInputCommand() && interaction.commandName === "addstock") {
      await interaction.deferReply({ ephemeral: true });

      if (!interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.editReply("❌ Admin only");

      const product = interaction.options.getString("product");
      const data = interaction.options.getString("data");

      await Stock.create({ product, data, used: false });
      return interaction.editReply("✅ Stock added");
    }

    /* IMPORT STOCK */
    if (interaction.isChatInputCommand() && interaction.commandName === "importstock") {
      await interaction.deferReply({ ephemeral: true });

      if (!interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.editReply("❌ Admin only");

      const product = interaction.options.getString("product");
      const file = interaction.options.getAttachment("file");
      const text = await (await fetch(file.url)).text();

      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        await Stock.create({ product, data: line, used: false });
      }

      return interaction.editReply(`✅ Imported ${lines.length} stock`);
    }

    /* STOCK COUNT */
    if (interaction.isChatInputCommand() && interaction.commandName === "stockcount") {
      await interaction.deferReply({ ephemeral: true });

      const stocks = await Stock.find({ used: false });
      const map = {};
      stocks.forEach(s => map[s.product] = (map[s.product] || 0) + 1);

      const desc = Object.entries(map)
        .map(([p, n]) => `📦 **${p}** → ${n}`)
        .join("\n") || "No stock";

      return interaction.editReply({
        embeds: [createEmbed("📊 Stock Count", desc)]
      });
    }

    /* MY ORDERS */
    if (interaction.isChatInputCommand() && interaction.commandName === "myorders") {
      await interaction.deferReply({ ephemeral: true });

      const orders = await Orders.find({ userId: interaction.user.id });
      if (!orders.length)
        return interaction.editReply("❌ No orders");

      return interaction.editReply({
        embeds: [createEmbed(
          "🧾 Your Orders",
          orders.map(o => `🆔 ${o.orderId} • ${o.product} • ${o.status}`).join("\n")
        )]
      });
    }

    /* CLEAR INVITES */
    if (interaction.isChatInputCommand() && interaction.commandName === "clearinvites") {
      await interaction.deferReply({ ephemeral: true });

      if (!interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.editReply("❌ Admin only");

      const user = interaction.options.getUser("target");

      await Invites.findOneAndUpdate(
        { guildId: interaction.guild.id, userId: user.id },
        { validInvites: 0, invitedMembers: [], leftMembers: [], fakeMembers: [] },
        { upsert: true }
      );

      return interaction.editReply(`✅ Cleared invites for <@${user.id}>`);
    }

    
    /* ---------- REQUEST BUTTON ---------- */
    if (interaction.isButton() && interaction.customId === "open_request") {
      return interaction.reply({
        embeds: [createEmbed("ðŸ›’ Select Product")],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("select_product")
            .setPlaceholder("Choose product")
            .addOptions(
              { label: "Minecraft Premium", value: "Minecraft Premium", emoji: "ðŸŽ®" },
              { label: "Crunchyroll Premium", value: "Crunchyroll Premium", emoji: "ðŸ¿" }
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
        embeds: [createEmbed("ðŸ›’ New Order").addFields(
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
        return interaction.editReply({ content: "âŒ Order rejected", components: [] });
      }

      const stock = await Stock.findOne({ product: order.product, used: false });
      if (!stock) return interaction.editReply({ content: "âŒ No stock", components: [] });

      stock.used = true;
      order.status = "completed";
      await stock.save();
      await order.save();

      const user = await client.users.fetch(order.userId).catch(() => null);
      if (user) {
        await user.send({
          embeds: [createEmbed("ðŸŽ‰ DELIVERY SUCCESSFUL", `ðŸ“¦ **${order.product}**\n\n||\`\`\`\n${stock.data}\n\`\`\`||`)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vouch_${orderId}`).setLabel("â­ Leave a Review").setStyle(ButtonStyle.Primary)
          )]
        }).catch(() => {});
      }

      return interaction.editReply({ content: "âœ… Delivered", components: [] });
    }

    /* ---------- VOUCH MODAL ---------- */
    if (interaction.isButton() && interaction.customId.startsWith("vouch_")) {
      const orderId = interaction.customId.split("_")[1];
      return interaction.showModal(
        new ModalBuilder().setCustomId(`vouch_modal_${orderId}`).setTitle("â­ Leave a Review")
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
      if (await Vouch.findOne({ orderId })) return interaction.editReply("âŒ Already reviewed");

      const rating = Number(interaction.fields.getTextInputValue("rating"));
      const message = interaction.fields.getTextInputValue("message");

      await Vouch.create({ orderId, userId: interaction.user.id, rating, message });

      client.channels.cache.get(config.vouchChannelID)?.send({
        embeds: [createEmbed("ðŸŒŸ New Review", `â­`.repeat(Math.min(Math.max(rating, 1), 5)) + `\n\n${message}\nðŸ‘¤ <@${interaction.user.id}>`)]
      });

      return interaction.editReply("âœ… Thanks for your review!");
    }

  } catch (err) {
    console.error("âŒ Interaction Error:", err);
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply("âŒ An error occurred. Check bot logs.");
    } else {
      return interaction.reply({ content: "âŒ An error occurred. Check bot logs.", ephemeral: true });
    }
                                                           }

    /* RESET INVITES */
    if (interaction.isChatInputCommand() && interaction.commandName === "resetinvites") {
      await interaction.deferReply({ ephemeral: true });

      if (!interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.editReply("❌ Admin only");

      await Invites.deleteMany({ guildId: interaction.guild.id });
      return interaction.editReply("✅ All invites reset");
    }

  } catch (err) {
    console.error("Interaction error:", err);
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
