const mongoose = require("mongoose");

const stockSchema = new mongoose.Schema({
  product: String,
  data: String,
  used: { type: Boolean, default: false }
});

module.exports = mongoose.model("Stock", stockSchema);
