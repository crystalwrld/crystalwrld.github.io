const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let bots = {};
let reconnectTimers = {};
let macros = {};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('add-alt', (altData) => {
        console.log('Adding alt:', altData);
        if (bots[altData.username]) {
            console.log(`Bot with username ${altData.username} already exists.`);
            return;
        }
        createBot(altData.username, altData.password);
    });

    socket.on('toggle-action', ({ username, action, state }) => {
        console.log(`Toggling ${action} for ${username}: ${state}`);
        const bot = bots[username];
        if (bot) {
            switch(action) {
                case 'jump':
                    state ? bot.setControlState('jump', true) : bot.setControlState('jump', false);
                    break;
                case 'sneak':
                    state ? bot.setControlState('sneak', true) : bot.setControlState('sneak', false);
                    break;
                case 'auto-feed':
                    bot.autoFeed = state;
                    break;
                case 'auto-reconnect':
                    bot.autoReconnect = state;
                    break;
            }
        }
    });

    socket.on('send-chat', ({ username, message }) => {
        console.log(`Sending chat for ${username}: ${message}`);
        const bot = bots[username];
        if (bot) {
            bot.chat(message);
            io.emit('chat-message', { username, message: `${username}: ${message}` });
        }
    });

    socket.on('add-macro', (macroData) => {
        console.log('Adding macro:', macroData);
        const { username, command, cooldown } = macroData;
        const bot = bots[username];
        if (bot) {
            if (!macros[username]) {
                macros[username] = [];
            }
            const intervalId = setInterval(() => {
                bot.chat(command);
            }, cooldown * 60000); // Convert minutes to milliseconds
            macros[username].push({ command, intervalId });
        }
    });

    socket.on('stop-alt', (username) => {
        console.log(`Stopping alt: ${username}`);
        const bot = bots[username];
        if (bot) {
            bot.quit();
            delete bots[username];
            clearTimeout(reconnectTimers[username]);
            delete reconnectTimers[username];
            io.emit('bot-stopped', username);
        }
    });

    socket.on('start-alt', (altData) => {
        console.log(`Starting alt: ${altData.username}`);
        if (!bots[altData.username]) {
            createBot(altData.username, altData.password);
        }
    });

    socket.on('reconnect-alt', (altData) => {
        console.log(`Reconnecting alt: ${altData.username}`);
        const bot = bots[altData.username];
        if (bot) {
            bot.quit();
            delete bots[altData.username];
        }
        setTimeout(() => {
            createBot(altData.username, altData.password);
        }, 5000);
    });

    socket.on('remove-alt', (username) => {
        console.log(`Removing alt: ${username}`);
        const bot = bots[username];
        if (bot) {
            bot.quit();
            delete bots[username];
            if (macros[username]) {
                macros[username].forEach(macro => clearInterval(macro.intervalId));
                delete macros[username];
            }
            clearTimeout(reconnectTimers[username]);
            delete reconnectTimers[username];
            io.emit('remove-alt', username);
        }
    });

    socket.on('remove-macros', (username) => {
        console.log(`Removing macros for: ${username}`);
        if (macros[username]) {
            macros[username].forEach(macro => clearInterval(macro.intervalId));
            delete macros[username];
            io.emit('remove-macros', username);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

function createBot(username, password) {
    if (bots[username]) {
        console.log(`Bot ${username} already exists.`);
        return;
    }

    const bot = mineflayer.createBot({
        host: 'play.jartexnetwork.net', // Change this to your server address
        port: 25565,       // Change this to your server port
        username: username,
        password: password,
        auth: 'offline',
        version: '1.18.2'
    });

    bot.autoFeed = false;
    bot.autoReconnect = false;
    bot.password = password; // Store password for reconnection

    bot.on('spawn', () => {
        console.log(`Bot ${username} spawned`);
        bot.chat(`/login ${password}`); // Automatically login with the password
        io.emit('bot-spawned', username);
        clearTimeout(reconnectTimers[username]);
        delete reconnectTimers[username];
    });

    bot.on('health', () => {
        if (bot.autoFeed && bot.food < 20) {
            const foodItem = bot.inventory.items().find(item => 
                item.name.includes('_apple') || 
                item.name.includes('bread') || 
                item.name.includes('cooked_')
            );
            if (foodItem) {
                bot.equip(foodItem, 'hand')
                    .then(() => bot.consume())
                    .catch(err => console.log(`Error while feeding ${username}: ${err}`));
            }
        }
    });

    bot.on('end', () => {
        console.log(`Bot ${username} disconnected`);
        io.emit('bot-disconnected', username);
        delete bots[username];
        if (bot.autoReconnect && !reconnectTimers[username]) {
            reconnectTimers[username] = setTimeout(() => {
                createBot(username, password);
            }, 5000); // Wait 5 seconds before reconnecting
        }
    });

    bot.on('kicked', (reason) => {
        console.log(`Bot ${username} kicked: ${reason}`);
        io.emit('bot-kicked', { username, reason });
    });

    bot.on('error', (err) => {
        console.log(`Bot ${username} error: ${err}`);
        io.emit('bot-error', { username, error: err.message });
    });

    bots[username] = bot;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
