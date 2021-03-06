import * as Discord from 'discord.js';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import { start } from 'repl';

dotenv.config();

const bot = new Discord.Client();
bot.login(process.env.DISCORD_BOT_KEY);
const prefix = "!qna";
const discordWhitelistChannel = process.env.DISCORD_WHITELIST_CHANNEL;

const discourseHeaders = {
  "Api-Key": process.env.DISCOURSE_API_KEY,
  "Api-Username": process.env.DISCOURSE_API_USERNAME,
  "content-type": "application/json"
}
const discourseURL = process.env.DISCOURSE_URL
const discourseCategory = process.env.DISCOURSE_CATEGORY


bot.once("ready", ()=>{console.log("Ready to A some Q!")});
bot.on('message', async (message) => {
  if(!message.content.startsWith(prefix) || !message.guild){ return; }
  const cmd = message.content.split(" ")[1]
  console.log("MSG: ", message.content);
  console.log("CMD: ", cmd);

  try{
    if(cmd.toLowerCase() == "thread"  && message.channel.id == discordWhitelistChannel){
      //!qna thread "How do I do a thing?" https://discordapp.com/channels/734962134160506912/734962134160506915/735353838294401105 https://discordapp.com/channels/734962134160506912/734962134160506915/735353863229407272 https://discordapp.com/channels/734962134160506912/734962134160506915/735353896977039400
      const startQuote = message.content.indexOf("\"");
      const endQuote = message.content.indexOf("\"", startQuote +1)
      const topic = message.content.slice(startQuote+1, endQuote);
      let args = []
      if(message.content.includes("app.com")){
        args = message.content.split("https://discordapp.com/channels/").filter(el => {if(el.includes("/")){return el;}}).map(el=>{return el.trim()})
      } else {
        args = message.content.split("https://discord.com/channels/").filter(el => {if(el.includes("/")){return el;}}).map(el=>{return el.trim()})
      }
      console.log("ARGS: ", args);
      await createNewTopic(message, topic, args)
    } else if (cmd.toLowerCase() == "help"){
      message.channel.send(returnHelpText())
    } else if (cmd.toLowerCase() == "post" && message.channel.id == discordWhitelistChannel){
      //!qna post 15 https://discordapp.com/channels/734962134160506912/734962134160506915/735353838294401105

      const topicId = message.content.split(" ")[2]
      let args = []

      if(message.content.includes("app.com")){
        args = message.content.split("https://discordapp.com/channels/").filter(el => {if(el.includes("/")){return el;}}).map(el=>{return el.trim()})
      } else {
        args = message.content.split("https://discord.com/channels/").filter(el => {if(el.includes("/")){return el;}}).map(el=>{return el.trim()})
      }

      console.log("ARGS: ", args);
      await addToTopicCondensed(message, topicId, args, false)
    } else if (cmd.toLowerCase() == "search"){
      //!qna search "Some Query"
      const startQuote = message.content.indexOf("\"");
      const endQuote = message.content.indexOf("\"", startQuote +1)
      const queryString = message.content.slice(startQuote+1, endQuote);
      await search(message, queryString);
    } else if (cmd.toLowerCase() == "test") {
      message.channel.send("Bot is online!");
    }
  } catch (e) {
    message.channel.send(e.message)
  }
});

async function createNewTopic(message:Discord.Message, topic:string, uriList:string[]){
  if(topic.length < 15){throw new Error(`Topic "${topic}" needs to be atleast 15 characters long (Discourse Requirement)`)}
  if(uriList.length < 1) {throw new Error("Please include atleast one discord message to be included in the Discourse thread");}

  const firstPost_DiscordChannel = <Discord.TextChannel>bot.channels.cache.get(uriList[0].split('/')[1])
  const firstMessage:Discord.Message = await firstPost_DiscordChannel.messages.fetch(uriList[0].split('/')[2])
  let msg = "Author: "+firstMessage.author.username+"\nMessage: \n\n"+firstMessage.content;
  if(msg.length < 20){throw new Error(`Post (${uriList[0].split("/")[2]}) needs to be atleast 20 characters!`)}

  //Create Topic
  let params = {
    method: "post",
    headers: discourseHeaders,
    body: JSON.stringify({
      title: topic,
      raw: msg,
      category: discourseCategory
    })
  }
  let topicJson = await (await fetch(discourseURL+'/posts.json', params)).json()
  if(topicJson.errors){throw new Error(JSON.stringify(topicJson.errors))}
  await addToTopicCondensed(message, topicJson.topic_id, uriList.slice(1,), true);

  const topicUrl = discourseURL+'/t/'+topicJson.topic_slug+"/"+topicJson.topic_id
  message.channel.send(`Topic "${topic}" created @ ${topicUrl}`)
}

async function addToTopicCondensed(message:Discord.Message, topic_id:string, uriList:string[], isThread:boolean){
  console.log("AddTopicCondensed recieved: " , uriList);
  if(uriList.length < 1) {return;}
  
  // Build A List of Discord Messages
  let allMsgs: Discord.Message[] = [];
  for(let uri of uriList){
    const channel:Discord.TextChannel =  <Discord.TextChannel>bot.channels.cache.get(uri.split('/')[1])
    const msg:Discord.Message = await channel.messages.fetch(uri.split('/')[2])
    allMsgs.push(msg);
  }

  let startingIdx = 0;
  let endIdx = -1;

  let topic_slug = ""

  while(endIdx < allMsgs.length){
    //console.log(`Start ${startingIdx} End ${endIdx}`)
    endIdx = getLastCummalativeIdx(allMsgs, startingIdx, allMsgs[startingIdx].author.username)
    console.log(`Start IDX: ${startingIdx} End IDX: ${endIdx}`)
    
    let postContent = ""
    for(let i=startingIdx; i<endIdx; i++){
      postContent += allMsgs[i].content + "\n"
    }


    let msgRaw = `Author: ${allMsgs[startingIdx].author.username} \n\n Message: \n\n ${postContent}`;
    let postParams = {
      method: 'post',
      headers: discourseHeaders,
      body: JSON.stringify({
        topic_id: topic_id,
        raw: msgRaw
      })
    }
    let response = await (await fetch(discourseURL+'/posts.json',postParams)).json()
    if(response.errors){throw new Error(JSON.stringify(response.errors))}
    topic_slug = response['topic_slug']   

    //endIdx + 1 or endIdx?
    startingIdx = endIdx;
    if(startingIdx >= allMsgs.length){break;}
  }

  if(!isThread){
    const topic_url = discourseURL+'/t/'+topic_slug+'/'+topic_id
    message.channel.send(`Posts added to topic: ${topic_url}`);
  }
}

async function search(message:Discord.Message, query:string){
  let searchUrl = discourseURL+'/search.json?q='+query;
  let results = await (await fetch(searchUrl)).json();
  let foundTopics = results.topics;
  //let foundPosts = results.posts; //very hard to create links to these so meh
  let response = "This is a list of threads where your search term appears: \n";
  for(let topic of foundTopics){
    response += '\n' + discourseURL + "/t/" + topic.slug + '/' + topic.id
  }
  message.channel.send(response);
}
function returnHelpText(){
  let res = 
`
QNA Bot
Description: This bot backs up threads from League of Extraordinary FoundryVTT Developer Discord to The Forge's Discourse Forum PACKAGE DEVELOPMENT category.
This should only be used for developer question and answer threads. 

Commands
Thread
Usage: \`!qna thread "some unique topic name" discordLink_first_post discordLink_second_post....\`
Description: Creates a new topic and creates posts under that topic based on discord links given.
The topic name must be unique and greater than 15 characters, whereas the post content should be greater than 20 characters.

Post
Usage: \`!qna post topic_id discordLink discordLink....\`
Description: Adds to an existing topic. Topc Id can be found as the last number on a given thread URL

Search
Usage: \`!qna search "query string"\`
Description: Returns entries relevant to query string

Help
Usage: \`!qna help\`
Description: Prints out the help section
`
  return res;
}

function getLastCummalativeIdx(array:Discord.Message[], idx: number, author:string){
  if(idx == array.length || array[idx].author.username != author){
    return idx;
  }
  return getLastCummalativeIdx(array, idx+1, author)
}