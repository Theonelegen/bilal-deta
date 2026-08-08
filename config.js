require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OWNER_ID: process.env.OWNER_ID ? process.env.OWNER_ID.split(",") : [],
  GH_TOKEN: process.env.GH_TOKEN,
  GH_REPO: process.env.GH_REPO,
  GH_TOKEN_FILE: process.env.GH_TOKEN_FILE,
  GH_UPDATE_FILE: process.env.GH_UPDATE_FILE,
};
