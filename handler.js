const rp = require('request-promise');
const mongoose = require('mongoose');

const MONGO_URL = process.env.MONGO_URL
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const START_RATING = 1000;
const KFACTOR = 32;

mongoose.connect(MONGO_URL);

const playerSchema = new mongoose.Schema({
  name: String,
  rating: Number,
  chat_id: Number,
  created_at: Date
});

const matchSchema = new mongoose.Schema({
  player1: String,
  player2: String,
  player1_score: Number,
  player2_score: Number,
  created_at: Date
});

const groupSchema = new mongoose.Schema({
  chat_id: Number
});

playerSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString()
    delete returnedObject._id
    delete returnedObject.__v
  }
})

matchSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString()
    delete returnedObject._id
    delete returnedObject.__v
  }
})

groupSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString()
    delete returnedObject._id
    delete returnedObject.__v
  }
})

const Player = mongoose.model('Player', playerSchema);
const Match = mongoose.model('Match', matchSchema);
const Group = mongoose.model('Group', groupSchema);

async function setTyping(chat_id) {
  const options = {
    method: 'GET',
    uri: `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`,
    qs: {
      chat_id,
      action: 'typing'
    }
  };

  return rp(options);
}

async function sendToUser(chat_id, text) {
  const options = {
    method: 'GET',
    uri: `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    qs: {
      chat_id,
      text
    }
  };

  return rp(options);
}

const sortByRating = (a, b) => {
  return b.rating - a.rating;
}

const calculateExpectedScore = (rating1, rating2) => {
  return 1 / (1 + Math.pow(10, (rating2 - rating1) / 400));
}

const calculateUpdatedRating = (rating1, rating2, score1) => {
  const expectedScore1 = calculateExpectedScore(rating1, rating2);
  return rating1 + KFACTOR * (score1 - expectedScore1);
}

const removeDuplicates = (arr) => {
  return arr.filter((item, index) => {
    return arr.indexOf(item) === index;
  }).sort(sortByRating);
}

module.exports.shortbot = async event => {
  try {
    const body = JSON.parse(event.body);
    if (!body.message.text || !body.message.chat) {
      return {
        statusCode: 500,
      }
    }
    const {chat, text} = body.message;

    setTyping(chat.id);

    if (chat.type !== 'private') {
      if (text.startsWith('/start')) {
        const group = await Group.findOne({chat_id: chat.id});
        if (!group) {
          const newGroup = new Group({
            chat_id: chat.id
          });
          await newGroup.save();
          await sendToUser(chat.id, 'Added group to shortbot! Type /help to see available commands.');
        } else {
          await sendToUser(chat.id, 'Group already added to shortbot! Type /help to see available commands.');
        }
      }

      return {
        statusCode: 200
      }
    }

    const username = chat.username.toLowerCase();

    let identified = false;

    if (username) {
      identified = true;
    }

    const current_player = await Player.findOne({name: username})

    if (current_player && !current_player.chat_id) {
      await Player.findOneAndUpdate({name: current_player.name}, {chat_id: chat.id});
    }

    if (text && identified) {
      if (text === '/start') {
        const userExists = await Player.exists({name: username});
        if (userExists) {
          await sendToUser(chat.id, `Welcome back ${username}! You have already registered. To see your rating, type /rating. To record a match, type /match.`);
        } else {
          const player = new Player({name: username, rating: START_RATING, chat_id: chat.id, created_at: new Date()});
          await player.save();
          await sendToUser(chat.id, `Welcome ${username}!`);
        }
      } else if (text === '/allmatches') {
        const matches = await Match.find()
        const matchString = matches.map(match => `${match.player1} ${match.player1_score} - ${match.player2_score} ${match.player2}`).join('\n')
        await sendToUser(chat.id, matchString);
      } else if (text === '/mymatches') {
        const player = current_player
        if (player) {
          const matches = await Match.find({$or: [{player1: player.name}, {player2: player.name}]})
          if (matches.length > 0) {
            const matchString = matches.map(match => `${match.player1} ${match.player1_score} - ${match.player2_score} ${match.player2}`).join('\n')
            await sendToUser(chat.id, matchString);
          } else {
            await sendToUser(chat.id, 'You have no matches recorded.');
          }
        } else {
          await sendToUser(chat.id, `You have not registered yet. To register, type /start.`);
        }
      } else if (text === '/rating') {
        const player = current_player
        await sendToUser(chat.id, `${username}'s rating is ${player.rating}`);
      } else if (text === '/allratings') {
        const players = await Player.find();
        const ratings = players.sort(sortByRating).map(player => `${player.name} (${player.rating})`);
        const message = `Best players according to rank:\n\n${ratings.join('\n')}`;
        await sendToUser(chat.id, message);
      } else if (text === '/matchcount') {
        const matches = await Match.find();
        const message = `${matches.length} matches played so far.`;
        await sendToUser(chat.id, message);
      } else if (text === '/me') {
        const player = current_player;
        const matches = await Match.find({$or: [{player1: player.name}, {player2: player.name}]});
        const message = `${username} (rating ${player.rating}) has played ${matches.length} matches.`;
        await sendToUser(chat.id, message);
      } else if (text.startsWith('/underthetable')) {
        const matches = await Match.find({});
        const players = matches.filter(match => {
          return match.player1_score === 0 || match.player2_score === 0;
        }).map(match => {
          if (match.player1_score === 0) {
            return match.player2;
          } else {
            return match.player1;
          }
        });
        if (players.length === 0) {
          await sendToUser(chat.id, `Nobody is under the table.`);
        } else {
          await sendToUser(chat.id, `These people have managed to keep from scoring a single point during a game: ${removeDuplicates(players).join(', ')}`);
        }
      } else if (text.startsWith('/match')) {
        let [, player1, player2, player1_score, player2_score] = text.split(' ');
        if (player1 && player2 && player1_score && player2_score) {

          const top_three = await Player.find({}).sort(sortByRating).limit(3);

          let flag = true;

          try {
            player1_score = Number(player1_score);
            player2_score = Number(player2_score);
          } catch (e) {
            flag = false;
            await sendToUser(chat.id, 'Invalid score(s)');
          }

          if (player1_score < 0 || player2_score < 0 || player1_score > 25 || player2_score > 25) {
            flag = false;
            await sendToUser(chat.id, 'A score must be over 0 and feasible (less than 25)');
          }

          const player1_exists = await Player.exists({name: player1});
          const player2_exists = await Player.exists({name: player2});

          if (!player1_exists || !player2_exists) {
            flag = false;
            await sendToUser(chat.id, 'One or more players do not exist. Are you sure you typed the name correctly? If no typos, please ask players to start the bot by typing /start.');
          }

          if (flag) {
            const player1_obj = await Player.findOne({name: player1});
            const player2_obj = await Player.findOne({name: player2});
            try {
              const match = new Match({
                player1,
                player2,
                player1_score,
                player2_score,
                created_at: new Date()
              });
              await match.save();

              const player1_newrating = parseInt(calculateUpdatedRating(player1_obj.rating, player2_obj.rating, player1_score > player2_score ? 1 : player1_score === player2_score ? 0.5 : 0));
              const player2_newrating = parseInt(calculateUpdatedRating(player2_obj.rating, player1_obj.rating, player2_score > player1_score ? 1 : player2_score === player1_score ? 0.5 : 0));

              await Player.findOneAndUpdate({name: player1}, {rating: player1_newrating});
              await Player.findOneAndUpdate({name: player2}, {rating: player2_newrating});

              if (player1 !== username && player1_obj.chat_id) {
                await sendToUser(player1_obj.chat_id, `A match against you was recorded: ${player2_score} (${player2}) - ${player1_score} (${player1}). Your new rating is ${player1_newrating}.`);
              }

              if (player2 !== username && player2_obj.chat_id) {
                await sendToUser(player1_obj.chat_id, `A match against you was recorded: ${player1_score} (${player1}) - ${player2_score} (${player2}). Your new rating is ${player2_newrating}.`);
              }

              await sendToUser(chat.id, `Match saved! The new ratings are ${player1_newrating} (${player1}) and ${player2_newrating} (${player2})`);
            } catch (e) {
              await sendToUser(chat.id, `Error saving match.`);
            }
          }

          const new_top_three = await Player.find({}).sort(sortByRating).limit(3);

          if (top_three.map(player => player.name).join(', ') !== new_top_three.map(player => player.name).join(', ')) {
            const groups = Group.find({});
            groups.forEach(group => {
              await sendToUser(group.chat_id, `There has been a change in power! The new top three are ${new_top_three.map(player => `${player.name} (${player.rank})`).join(', ')}`);
            })
          }
        } else {
          await sendToUser(chat.id, `Usage: /match player1 player2 player1_score player2_score where player1 and player2 are telegram usernames and player1_score and player2_score are integers.`);
        }
      } else {
        await sendToUser(chat.id, `Unknown command "${text}"`);
      }
    } else if (!identified) {
      await sendToUser(chat.id, `We can't identify you. Please create a Telegram nickname and type /start.`);
    } else {
      await sendToUser(chat.id, 'Text message is expected.');
    }
  } catch (e) {
    console.log('log: ' + e);
    await sendToUser(chat.id, 'An unexpected error happened.');
  }

  return { statusCode: 200 };
};