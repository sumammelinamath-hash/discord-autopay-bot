const mongoose = require("mongoose");

const ordersSchema = new mongoose.Schema({
  orderId: String,
  userId: String,
  product: String,
  status: { type: String, default: "pending" }
});

module.exports = mongoose.model("Orders", ordersSchema);
