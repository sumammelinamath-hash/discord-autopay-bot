const mongoose = require("mongoose");

const inviteSchema = new mongoose.Schema({
  userId: { type: String, required: true },     // Discord user ID
  guildId: { type: String, required: true },    // Discord server ID
  validInvites: { type: Number, default: 0 },   // Valid invites count
  totalInvites: { type: Number, default: 0 },
  leftMembers: { type: [String], default: [] }, // who left
  fakeMembers: { type: [String], default: [] },
  invitedMembers: { type: [String], default: [] }
});

module.exports = mongoose.model("Invites", inviteSchema);
