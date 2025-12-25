module.exports = {
  token: process.env.TOKEN,
  mongoURI: process.env.MONGO_URI,
  adminRoleID: process.env.ADMIN_ROLE_ID,
  adminChannelID: process.env.ADMIN_CHANNEL_ID,
  vouchChannelID: process.env.VOUCH_CHANNEL_ID,
  brand: {
    name: process.env.BRAND_NAME || "MineCom",
    color: process.env.BRAND_COLOR || "#00ff99",
    logo: process.env.BRAND_LOGO || "https://raw.githubusercontent.com/sumammelinamath-hash/MineCom/main/file_0000000063f87209a45937bc7fe7bdea.png",
    footer: process.env.BRAND_FOOTER || "💠 MineCom • Secure Auto Delivery",
    supportUrl: process.env.BRAND_SUPPORT_URL || "https://discord.gg/freemcfa"
  }
};
