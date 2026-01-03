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
        o.setName("target")
          .setDescription("Select member")
          .setRequired(true)
      )
  ]);
});

/* ================= INVITE TRACKING ================= */
client.on("guildMemberAdd", async member => {
  const cached = inviteCache.get(member.guild.id) || new Map();
  const invites = await member.guild.invites.fetch();

  let used;
  for (const inv of invites.values()) {
    if ((cached.get(inv.code) || 0) < inv.uses) {
      used = inv;
      break;
    }
  }

  inviteCache.set(member.guild.id, new Map(invites.map(i => [i.code, i.uses])));
  if (!used || !used.inviter) return;

  const update = member.user.bot
    ? { $addToSet: { fakeMembers: member.id } }
    : { $inc: { validInvites: 1 }, $addToSet: { invitedMembers: member.id } };

  await Invites.findOneAndUpdate(
    { guildId: member.guild.id, userId: used.inviter.id },
    update,
    { upsert: true }
  );
});

client.on("guildMemberRemove", async member => {
  const data = await Invites.findOne({ guildId: member.guild.id, invitedMembers: member.id });
  if (!data) return;

  data.validInvites = Math.max(data.validInvites - 1, 0);
  data.invitedMembers = data.invitedMembers.filter(i => i !== member.id);
  data.leftMembers.push(member.id);
  await data.save();
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  try {

    /* PANEL */
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
      return interaction.reply({
        embeds: [createEmbed(
          "<a:cart21:1454879646255681558> Mine Premium Store",
          "<a:zapp:1454474883449749626> **Fast Auto Delivery**\n<a:locked20:1454475603754487819> **Secure & Trusted**\n<a:sos20:1454450996653719643> **24/7 Support**"
        )],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("open_request").setLabel("Request").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setLabel("Support").setStyle(ButtonStyle.Link).setURL(BRAND.supportUrl)
        )]
      });
    }

    /* CLEAR INVITES (USER) */
    if (interaction.isChatInputCommand() && interaction.commandName === "clearinvites") {
      if (!interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const user = interaction.options.getUser("target");
      await Invites.findOneAndUpdate(
        { guildId: interaction.guild.id, userId: user.id },
        { validInvites: 0, invitedMembers: [], leftMembers: [], fakeMembers: [] },
        { upsert: true }
      );

      return interaction.reply({ content: `✅ Cleared invites for <@${user.id}>`, ephemeral: true });
    }

    /* RESET ALL INVITES */
    if (interaction.isChatInputCommand() && interaction.commandName === "resetinvites") {
      if (!interaction.member.roles.cache.has(config.adminRoleID))
        return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      await Invites.deleteMany({ guildId: interaction.guild.id });
      return interaction.reply({ content: "✅ All invites reset", ephemeral: true });
    }

  } catch (err) {
    console.error(err);
  }
});

/* ================= LOGIN ================= */
client.login(config.token);
