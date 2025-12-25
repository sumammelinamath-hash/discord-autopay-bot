const mongoose = require("mongoose");

const vouchSchema = new mongoose.Schema({
  orderId: String,
  userId: String,
  rating: Number,
  message: String
});

module.exports = mongoose.model("Vouch", vouchSchema);
