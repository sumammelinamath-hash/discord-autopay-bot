const CheckedAccount = require("../models/CheckedAccount");

async function runChecker(email, password, sourceFile) {
  try {
    // 🔐 MOCK LOGIN CHECK (replace later)
    const premium = true;

    // 🟣 MOCK HYPIXEL CHECK (replace later)
    const hypixelBanned = Math.random() > 0.7;

    let category = "invalid";

    if (premium && !hypixelBanned) {
      category = "premium_unbanned";
    } else if (premium && hypixelBanned) {
      category = "premium_banned";
    }

    await CheckedAccount.create({
      email,
      password,
      premium,
      hypixelBanned,
      category,
      sourceFile,
      status: "available"
    });

  } catch (err) {
    console.error("CHECKER ERROR:", err);
  }
}

module.exports = runChecker;
