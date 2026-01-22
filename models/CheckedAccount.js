const mongoose = require("mongoose");

const CheckedAccountSchema = new mongoose.Schema({
  email: { type: String, required: true },
  password: { type: String, required: true },

  premium: Boolean,
  hypixelBanned: Boolean,

  category: {
    type: String,
    enum: [
      "premium_unbanned",
      "premium_banned",
      "invalid"
    ]
  },

  status: {
    type: String,
    enum: ["available", "delivered"],
    default: "available"
  },

  sourceFile: String,

  checkedAt: { type: Date, default: Date.now },

  deliveredTo: String,
  deliveredAt: Date
});

module.exports = mongoose.model("CheckedAccount", CheckedAccountSchema);
