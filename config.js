module.exports = {
  token: process.env.TOKEN,
  mongoURI: process.env.MONGO_URI,
  adminRoleID: process.env.ADMIN_ROLE_ID,
  adminChannelID: process.env.ADMIN_CHANNEL_ID,
  logChannelID: process.env.LOG_CHANNEL_ID,
  vouchChannelID: process.env.VOUCH_CHANNEL_ID,
  
  brand: {
    name: "MineCom Store",
    color: 0x00ff99,
    logo: "https://i.imgur.com/9QO4Z9f.png",
    footer: "💠 MineCom • Secure Auto Delivery",
    supportUrl: "https://discord.gg/yourserver"
  }
};
