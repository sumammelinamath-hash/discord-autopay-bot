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
const Invites = require("./models/Invite");

// =====================
// GLOW SYSTEM (PUT HERE ✅)
// =====================
const GLOW = {
  purple: 0x9b5cff,
  blue: 0x00eaff,
  green: 0x00ff9c,
  red: 0xff3b3b,
  gold: 0xffd700
};
const GLOW_CYCLE = [
  GLOW.purple,
  GLOW.blue,
  GLOW.green,
  GLOW.red,
  GLOW.gold
];

function glowEmbed(title, description, color = GLOW.purple) {
  return new EmbedBuilder()
    .setColor(color) // animated glow color
    .setTitle(title)
    .setAuthor({
      name: `✦ ${BRAND.name} ✦`,
      iconURL: BRAND.logo
    })
    .setDescription(description)
    .setFooter({
      text: "✨ Premium Neon Experience",
      iconURL: BRAND.logo
    })
    .setTimestamp();
}

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

// 🔹 Invite Cache
const inviteCache = new Map();

/* ================= BRAND ================= */
const BRAND = config.brand;
const EMOJIS = { cart: "🛒", fire: "🔥", star: "⭐", support: "🆘" };

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

  // 🔹 Fill invite cache for all guilds
  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) continue;
    inviteCache.set(
      guild.id,
      new Map(invites.map(inv => [inv.code, inv.uses]))
    );
  }

  // Status rotation
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

  // Slash commands
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
    new SlashCommandBuilder().setName("myorders").setDescription("Your orders"),
    new SlashCommandBuilder().setName("resetinvites").setDescription("🔄 Reset all invite stats (Admin only)"),
    new SlashCommandBuilder()
      .setName("clearinvites")
      .setDescription("Clear invites for all members or a specific user")
      .addSubcommand(sub =>
        sub.setName("all").setDescription("Clear invites for all members")
      )
      .addSubcommand(sub =>
        sub.setName("user")
          .setDescription("Clear invites for a specific member")
          .addUserOption(option => option.setName("target").setDescription("Select a member").setRequired(true))
      )
  ]);
});

/* ================= INVITE TRACKING ================= */
client.on("guildMemberAdd", async member => {
  try {
    const cachedInvites = inviteCache.get(member.guild.id) || new Map();
    const newInvites = await member.guild.invites.fetch();

    let usedInvite = null;
    for (const invite of newInvites.values()) {
      const oldUses = cachedInvites.get(invite.code) || 0;
      if (invite.uses > oldUses) {
        usedInvite = invite;
        break;
      }
    }

    inviteCache.set(
      member.guild.id,
      new Map(newInvites.map(i => [i.code, i.uses]))
    );

    if (!usedInvite || !usedInvite.inviter) return;

    const isFake = member.user.bot; // bots = fake
    const update = { $inc: { totalInvites: 1 } };

    if (isFake) update.$addToSet = { fakeMembers: member.id };
    else { update.$inc.validInvites = 1; update.$addToSet = { invitedMembers: member.id }; }

    await Invites.findOneAndUpdate(
      { userId: usedInvite.inviter.id, guildId: member.guild.id },
      update,
      { upsert: true }
    );

    console.log(`${member.user.tag} joined via ${usedInvite.code} by ${usedInvite.inviter.tag}`);
  } catch (err) {
    console.error("Invite tracking error:", err);
  }
});

client.on("guildMemberRemove", async member => {
  try {
    const inviterData = await Invites.findOne({
      guildId: member.guild.id,
      invitedMembers: member.id
    });
    if (!inviterData) return;

    inviterData.validInvites = Math.max((inviterData.validInvites || 1) - 1, 0);
    inviterData.leftMembers ??= [];
    if (!inviterData.leftMembers.includes(member.id)) inviterData.leftMembers.push(member.id);
    inviterData.invitedMembers = inviterData.invitedMembers.filter(id => id !== member.id);

    await inviterData.save();
    console.log(`Member left: ${member.user.tag}, decremented inviter ${inviterData.userId} invites`);
  } catch (err) {
    console.error("Invite leave tracking error:", err);
  }
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  try {
    // ---------- PANEL ----------
if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
  await interaction.deferReply();

  // Original description
  const description = "<a:zapp:1454474883449749626> Fast Auto Delivery\n<a:locked20:1454475603754487819> Secure & Trusted\n<a:sos20:1454450996653719643> 24/7 Support";

  // Start color index
  let colorIndex = 0;

  // Create first embed
  const embed = glowEmbed(`${EMOJIS.cart} Legit Cloud Premium Store`, description, GLOW_CYCLE[colorIndex]);

  // Send the reply
  const msg = await interaction.editReply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("open_request")
          .setLabel("Request")
          .setEmoji({ id: "1454450202168524903" })
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setLabel("Support")
          .setEmoji({ id: "1454450996653719643" })
          .setStyle(ButtonStyle.Link)
          .setURL(BRAND.supportUrl)
      )
    ]
  });

  // Animated glow effect: change color every 1 second
  const interval = setInterval(() => {
    colorIndex = (colorIndex + 1) % GLOW_CYCLE.length;
    const newEmbed = glowEmbed(`${EMOJIS.cart} Mine Premium Store`, description, GLOW_CYCLE[colorIndex]);
    msg.edit({ embeds: [newEmbed] }).catch(() => clearInterval(interval)); // stop if message deleted
  }, 1000);
}

    // ---------- ADD STOCK ----------
    if (interaction.isChatInputCommand() && interaction.commandName === "addstock") {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.member.roles.cache.has(config.adminRoleID)) return interaction.editReply("❌ Admin only");
      const product = interaction.options.getString("product");
      const data = interaction.options.getString("data");
      await Stock.create({ product, data, used: false });
      return interaction.editReply("✅ Stock added");
    }

    // ---------- IMPORT STOCK ----------
    if (interaction.isChatInputCommand() && interaction.commandName === "importstock") {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.member.roles.cache.has(config.adminRoleID)) return interaction.editReply("❌ Admin only");

      const product = interaction.options.getString("product");
      const file = interaction.options.getAttachment("file");
      if (!file?.name.endsWith(".txt")) return interaction.editReply("❌ Only .txt files allowed");

      const text = await (await fetch(file.url)).text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) await Stock.create({ product, data: line, used: false });

      return interaction.editReply(`✅ Imported ${lines.length} stocks`);
    }

    // ---------- STOCK COUNT ----------
    if (interaction.isChatInputCommand() && interaction.commandName === "stockcount") {
      const stocks = await Stock.find({ used: false });
      if (!stocks.length) return interaction.reply({ content: "❌ No stock", ephemeral: true });

      const map = {};
      stocks.forEach(s => map[s.product] = (map[s.product] || 0) + 1);
      const desc = Object.entries(map).map(([p, n]) => `📦 ${p} → ${n}`).join("\n");
      return interaction.reply({ embeds: [createEmbed("📊 Stock Count", desc)], ephemeral: true });
    }

    // ---------- MY ORDERS ----------
    if (interaction.isChatInputCommand() && interaction.commandName === "myorders") {
      const orders = await Orders.find({ userId: interaction.user.id });
      if (!orders.length) return interaction.reply({ content: "❌ No orders", ephemeral: true });

      const desc = orders.map(o => `🆔 ${o.orderId} • ${o.product} • ${o.status}`).join("\n");
      return interaction.reply({ embeds: [createEmbed("🧾 Your Orders", desc)], ephemeral: true });
    }

    // ---------- RESET INVITES ----------
    if (interaction.isChatInputCommand() && interaction.commandName === "resetinvites") {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.member.roles.cache.has(config.adminRoleID)) return interaction.editReply("❌ Admin only");

      await Invites.deleteMany({ guildId: interaction.guild.id });
      const invites = await interaction.guild.invites.fetch().catch(() => null);
      if (invites) inviteCache.set(interaction.guild.id, new Map(invites.map(i => [i.code, i.uses])));

      return interaction.editReply("✅ All members' invites have been cleared!");
    }

    // ---------- CLEAR INVITES ----------
    if (interaction.isChatInputCommand() && interaction.commandName === "clearinvites") {
      const sub = interaction.options.getSubcommand();
      if (!interaction.member.roles.cache.has(config.adminRoleID)) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      if (sub === "all") {
        await Invites.updateMany({ guildId: interaction.guild.id }, { validInvites: 0, leftMembers: [], fakeMembers: [], invitedMembers: [] });
        return interaction.reply({ content: "✅ All members' invites have been cleared!", ephemeral: true });
      }

      if (sub === "user") {
        const user = interaction.options.getUser("target");
        if (!user) return interaction.reply({ content: "❌ User not found", ephemeral: true });

        await Invites.findOneAndUpdate({ guildId: interaction.guild.id, userId: user.id }, { validInvites: 0, leftMembers: [], fakeMembers: [], invitedMembers: [] }, { upsert: true });
        return interaction.reply({ content: `✅ Cleared invites for <@${user.id}>`, ephemeral: true });
      }
    }

    // ---------- REQUEST BUTTON ----------
    if (interaction.isButton() && interaction.customId === "open_request") {
      await interaction.deferUpdate();
      await interaction.followUp({
        ephemeral: true,
        embeds: [createEmbed("🛒 Select Product", "Choose a product from the menu below 👇")],
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("select_product")
            .setPlaceholder("Choose product")
            .addOptions(
              { label: "Minecraft Premium", value: "Minecraft Premium", emoji: "🎮" },
              { label: "Minecraft Donut Unban", value: "Minecraft Donut Unban", emoji: "🍩" },
              { label: "Minecraft Redeem Code (Method)", value: "Minecraft Redeem Code (Method)", emoji: "🧾" },
              { label: "Minecraft Premium (Own Pass)", value: "Minecraft Premium (Own Pass)", emoji: "🔐" },
              { label: "Roblox $50 Gift Card (Method)", value: "Roblox $50 Gift Card (Method)", emoji: "🎁" },
              { label: "Roblox $100 Gift Card (Method)", value: "Roblox $100 Gift Card (Method)", emoji: "💎" },
              { label: "Nitro Basic (Method)", value: "Nitro Basic (Method)", emoji: "⚡" },
              { label: "Nitro Boost (Method)", value: "Nitro Boost (Method)", emoji: "🚀" },
              { label: "MCFA (3 Months)", value: "MCFA (3 Months)", emoji: "🛡️" }
            )
        )]
      });
    }

    // ---------- SELECT PRODUCT ----------
    if (interaction.isStringSelectMenu() && interaction.customId === "select_product") {
      await interaction.deferUpdate();
      const product = interaction.values[0];
      if (!product) return;

      const orderId = `ORD-${Date.now()}`;

      // Invite stats for user
      const inviteData = await Invites.findOne({
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
      const valid = inviteData?.validInvites || 0;
      const left = inviteData?.leftMembers?.length || 0;
      const fake = inviteData?.fakeMembers?.length || 0;

      await Orders.create({ orderId, userId: interaction.user.id, product, status: "pending" });

      const adminChannel = client.channels.cache.get(config.adminChannelID);
      adminChannel?.send({
        embeds: [createEmbed("🛒 New Order").addFields(
          { name: "User", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Product", value: product, inline: true },
          { name: "Order ID", value: orderId, inline: true },
          { name: "Invites ✅", value: `${valid}`, inline: true },
          { name: "Left ❌", value: `${left}`, inline: true },
          { name: "Fake 🚫", value: `${fake}`, inline: true }
        )],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${orderId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`reject_${orderId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        )]
      });
    }

    // ---------- APPROVE / REJECT ----------
    if (interaction.isButton() && (interaction.customId.startsWith("approve_") || interaction.customId.startsWith("reject_"))) {
      await interaction.deferUpdate();
      if (!interaction.member.roles.cache.has(config.adminRoleID)) return;

      const [action, orderId] = interaction.customId.split("_");
      const order = await Orders.findOne({ orderId });
      if (!order || order.status !== "pending") return;

      if (action === "reject") {
        order.status = "rejected";
        await order.save();
        return interaction.followUp({ content: "❌ Order rejected", components: [] });
      }

      const stock = await Stock.findOne({ product: order.product, used: false });
      if (!stock) return interaction.followUp({ content: "❌ No stock", components: [] });

      stock.used = true;
      order.status = "completed";
      await stock.save();
      await order.save();

      const user = await client.users.fetch(order.userId).catch(() => null);
      if (user) {
        await user.send({
          embeds: [createEmbed("🎉 DELIVERY SUCCESSFUL", `📦 ${order.product}\n\n||\`\`\`\n${stock.data}\n\`\`\`||`)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vouch_${orderId}`).setLabel("⭐ Leave a Review").setStyle(ButtonStyle.Primary)
          )]
        }).catch(() => {});
      }

      return interaction.followUp({ content: "✅ Delivered", components: [] });
    }

    // ---------- VOUCH MODAL ----------
    if (interaction.isButton() && interaction.customId.startsWith("vouch_")) {
      const orderId = interaction.customId.split("_")[1];
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`vouch_modal_${orderId}`)
          .setTitle("⭐ Leave a Review")
          .addComponents([
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("rating").setLabel("Rating (1-5)").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("message").setLabel("Your Review").setStyle(TextInputStyle.Paragraph).setRequired(true)
            )
          ])
      );
    }

    // ---------- VOUCH SUBMIT ----------
    if (interaction.isModalSubmit() && interaction.customId.startsWith("vouch_modal_")) {
      await interaction.deferReply({ ephemeral: true });
      const orderId = interaction.customId.split("_")[2];

      if (await Vouch.findOne({ orderId }))
        return interaction.editReply("❌ You already left a review for this order.");

      const rating = Math.min(
        Math.max(parseInt(interaction.fields.getTextInputValue("rating")), 1),
        5
      );
      const message = interaction.fields.getTextInputValue("message");

      await Vouch.create({ orderId, userId: interaction.user.id, rating, message });

      const vouchChannel = await client.channels.fetch(config.vouchChannelID).catch(() => null);

      if (vouchChannel?.isTextBased()) {
        await vouchChannel.send({
          embeds: [
            createEmbed(
              "🌟 New Review",
              `⭐`.repeat(rating) + `\n\n${message}\n👤 <@${interaction.user.id}>`
            )
          ]
        });
      }

      return interaction.editReply("✅ Thank you! Your review has been submitted.");
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
