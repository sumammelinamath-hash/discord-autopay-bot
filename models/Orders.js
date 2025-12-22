const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  orderId: String,
  userId: String,
  product: String,
  status: { type: String, default: "pending" }
});

module.exports = mongoose.model("Orders", orderSchema);
