# Telegram Pingpong Ranking

You know you're better at pingpong than your coworkers but now there is an official way to prove it. This bot tracks matches between individuals and calculates rankings between users. Communication is handled through Telegram.

## Setting up the bot

This bot uses MongoDB to store results and user data. Runs in AWS Lambda and is deployed using the Serverless Framework. Communication to Telegram is handled through the Telegram Bot API.

Set up a MongoDB cluster and connect it to the app by filling the url in env.json. After this set up Serverless deployments for example with this (https://www.serverless.com/framework/docs/providers/aws/guide/deploying/) guide. Finally, you need a Telegram bot and to put its token into the env.json. Here is a good guide for this: https://core.telegram.org/bots#creating-a-new-bot. Don't forget to set up the Telegram webhook url (https://riptutorial.com/telegram-bot/example/32215/setup-the-webhook).

After this you should be good to go!

## Usage

To record a match send

    /match player1 player2 score1 score2

to the bot. Here players are tgnicks and scores are score numbers. For example:

    /match dragonslayer betachad 11 8