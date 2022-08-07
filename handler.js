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
  chat_id: Number
});

const matchSchema = new mongoose.Schema({
  player1: String,
  player2: String,
  player1_score: Number,
  player2_score: Number
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

const Player = mongoose.model('Player', playerSchema);
const Match = mongoose.model('Match', matchSchema);

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

module.exports.shortbot = async event => {
  const body = JSON.parse(event.body);
  const {chat, text} = body.message;

  let identified = false;

  if (chat.username) {
    identified = true;
  }

  const current_player = await Player.findOne({name: chat.username})

  if (!current_player.chat_id) {
    await Player.findOneAndUpdate({name: current_player.name}, {chat_id: chat.id});
  }

  try {
    if (text && identified) {
      if (text === '/start') {
        let players = null
        try {
          players = await Player.find({name: chat.username});
        } catch (e) {
          console.log(e);
        }
        if (players && players.length > 0) {
          await sendToUser(chat.id, `Welcome back ${chat.username}! You have already registered. To see your rating, type /rating. To record a match, type /match.`);
        } else {
          const player = new Player({name: chat.username, rating: START_RATING, chat_id: chat.id});
          await player.save();
          await sendToUser(chat.id, `Welcome ${chat.username}!`);
        }
      } else if (text === '/allmatches') {
        const matches = await Match.find()
        const matchString = matches.map(match => `${match.player1} ${match.player1_score} - ${match.player2_score} ${match.player2}`).join('\n')
        await sendToUser(chat.id, matchString);
      } else if (text === '/mymatches') {
        const player = current_player
        if (player) {
          const matches = await Match.find({$or: [{player1: player.name}, {player2: player.name}]})
          const matchString = matches.map(match => `${match.player1} ${match.player1_score} - ${match.player2_score} ${match.player2}`).join('\n')
          await sendToUser(chat.id, matchString);
        } else {
          await sendToUser(chat.id, `You have not registered yet. To register, type /start.`);
        }
      } else if (text === '/rating') {
        const player = current_player
        await sendToUser(chat.id, `${chat.username}'s rating is ${player.rating}`);
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
        const message = `${chat.username} (rating ${player.rating}) has played ${matches.length} matches.`;
        await sendToUser(chat.id, message);
      } else if (text.startsWith('/match')) {
        let [, player1, player2, player1_score, player2_score] = text.split(' ');
        if (player1 && player2 && player1_score && player2_score) {
          let flag = true;
          try {
            player1_score = Number(player1_score);
            player2_score = Number(player2_score);
          } catch (e) {
            flag = false;
            await sendToUser(chat.id, 'Invalid score(s)');
          }

          let player1_obj = null
          let player2_obj = null
          try {
            player1_obj = await Player.findOne({name: player1});
            player2_obj = await Player.findOne({name: player2});
          } catch (e) {
            flag = false;
            await sendToUser(chat.id, `One of the players doesn't exist.`);
          }
          if (flag) {
            try {
              const match = new Match({
                player1,
                player2,
                player1_score,
                player2_score
              });
              await match.save();

              const player1_newrating = parseInt(calculateUpdatedRating(player1_obj.rating, player2_obj.rating, player1_score > player2_score ? 1 : player1_score === player2_score ? 0.5 : 0));
              const player2_newrating = parseInt(calculateUpdatedRating(player2_obj.rating, player1_obj.rating, player2_score > player1_score ? 1 : player2_score === player1_score ? 0.5 : 0));

              await Player.findOneAndUpdate({name: player1}, {rating: player1_newrating});
              await Player.findOneAndUpdate({name: player2}, {rating: player2_newrating});

              const other_player_obj = player1 === chat.username ? player2_obj : player1_obj;

              if (other_player_obj.chat_id) {
                await sendToUser(other_player_obj.chat_id, `${chat.username} just recorded a match against you with a score of ${player1_score} - ${player2_score}.`);
              }

              await sendToUser(chat.id, `Match saved! The new ratings are ${player1_newrating} (${player1}) and ${player2_newrating} (${player2})`);
            } catch (e) {
              await sendToUser(chat.id, `Error saving match.`);
            }
          }
        } else {
          await sendToUser(chat.id, `Usage: /match <player1> <player2> <player1_score> <player2_score> where player1 and player2 are telegram usernames and player1_score and player2_score are integers.`);
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
    console.log(e);
    await sendToUser(chat.id, 'An unexpected error happened.');
  }

  return { statusCode: 200 };
};