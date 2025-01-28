import { IncomingMessage } from "http";
import { get, RequestOptions } from "https";
import { writeFileSync } from "fs";
import { writeFile } from "fs/promises";
import { ReadableStream } from "stream/web";
const request = require("request");

import fs from "fs";
import axios from "axios";
import moment from "moment";
import { join } from "path";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import { getProfile, getWabaMediaUrl, profilePsid, sendText } from "./graphAPI";
import Whatsapp from "../../models/Whatsapp";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import { debounce } from "../../helpers/Debounce";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import formatBody from "../../helpers/Mustache";
import Queue from "../../models/Queue";
import Chatbot from "../../models/Chatbot";
import Message from "../../models/Message";
import { sayChatbot } from "../WbotServices/ChatbotListenerFacebook";
import ListSettingsService from "../SettingServices/ListSettingsService";
import { isNil, isNull, head } from "lodash";
import FindOrCreateATicketTrakingService from "../TicketServices/FindOrCreateATicketTrakingService";
import QueueIntegrations from "../../models/QueueIntegrations";
import {
  handleRating,
  verifyRating
} from "../WbotServices/wbotMessageListener";
import CompaniesSettings from "../../models/CompaniesSettings";
import sendFacebookMessage from "./sendFacebookMessage";
import { Mutex } from "async-mutex";
import TicketTag from "../../models/TicketTag";
import Tag from "../../models/Tag";
import ShowQueueIntegrationService from "../QueueIntegrationServices/ShowQueueIntegrationService";
import { ActionsWebhookService } from "../WebhookService/ActionsWebhookService";
import { FlowBuilderModel } from "../../models/FlowBuilder";
import { FlowDefaultModel } from "../../models/FlowDefault";
import { IConnections, INodes } from "../WebhookService/DispatchWebHookService";

import { differenceInMilliseconds } from "date-fns";
import { ActionsWebhookFacebookService } from "./WebhookFacebookServices/ActionsWebhookFacebookService";

import { WebhookModel } from "../../models/Webhook";
import { any, is } from "bluebird";
import ShowTicketService from "../TicketServices/ShowTicketService";
import TicketTraking from "../../models/TicketTraking";
import sendWabaMessageService from "./WabaService/sendWabaMessageService";
import { ActionsWebhookWabaService } from "./WabaService/WebhookWabaService/ActionsWebhookWabaService";
import { FlowCampaignModel } from "../../models/FlowCampaign";

type WWCustoResponse = IncomingMessage & {
  body: ReadableStream<Uint16Array> | null;
};

interface IMe {
  name: string;
  // eslint-disable-next-line camelcase
  first_name: string;
  // eslint-disable-next-line camelcase
  last_name: string;
  // eslint-disable-next-line camelcase
  profile_pic: string;
  id: string;
}

export interface Root {
  object: string;
  entry: Entry[];
}

export interface Entry {
  id: string;
  time: number;
  messaging: Messaging[];
}

export interface Messaging {
  sender: Sender;
  recipient: Recipient;
  timestamp: number;
  message: MessageX;
}

export interface Sender {
  id: string;
}

export interface Recipient {
  id: string;
}

export interface MessageX {
  mid: string;
  text: string;
  reply_to: ReplyTo;
}

export interface ReplyTo {
  mid: string;
}

type Media = {
  id?: string;
  filename?: string;
  mime_type?: string;
  caption?: string | null | undefined;
};

interface Phone {
  phone: string;   // Número de telefone
  wa_id: string;   // Identificador do WhatsApp
  type: string;    // Tipo de telefone (ex: CELL)
}

interface Name {
  first_name: string;      // Primeiro nome
  last_name: string;       // Sobrenome
  formatted_name: string;  // Nome formatado
}

interface IContact {
  name: Name;             // Objeto que contém o nome
  phones: Phone[];        // Array de objetos Phone
}

interface IContacts {
  contacts: IContact[];    // Array de objetos Contact
}

type TMessage = {
  recipient_type: "individual";
  id: string;
  messaging_product: "whatsapp";
  to: string;
  type?: "document" | "image" | "text" | "video" | "audio" | "template" | "contacts";
  audio?: Media;
  document?: Media;
  video?: Media;
  image?: Media;
  sticker?: Media;
  contacts?: IContacts;
  text?: {
      body: string,
  },
};

const verifyContact = async (msgContact: any, token: any, companyId: any) => {
  if (!msgContact) return null;

  const contactData = {
    name:
      msgContact?.name || `${msgContact?.first_name} ${msgContact?.last_name}`,
    number: msgContact.id,
    profilePicUrl: msgContact.profile_pic,
    isGroup: false,
    companyId: companyId,
    channel: token.channel,
    whatsappId: token.id
  };

  const contact = await CreateOrUpdateContactService(contactData);

  return contact;
};

export const verifyMessageFace = async (
  msg: any,
  body: any,
  ticket: Ticket,
  contact: Contact,
  fromMe: boolean = false
) => {
  const quotedMsg = await verifyQuotedMessage(msg);
  const messageData = {
    wid: msg.mid || msg.message_id,
    ticketId: ticket.id,
    contactId: fromMe ? undefined : msg.is_echo ? undefined : contact.id,
    body: msg.text || body,
    fromMe: fromMe ? fromMe : msg.is_echo ? true : false,
    read: fromMe ? fromMe : msg.is_echo,
    quotedMsgId: quotedMsg?.id,
    ack: 3,
    dataJson: JSON.stringify(msg),
    channel: ticket.channel
  };

  await CreateMessageService({ messageData, companyId: ticket.companyId });

  // await ticket.update({
  //   lastMessage: msg.text
  // });
};

export const verifyMessageMedia = async (
  msg: any,
  ticket: Ticket,
  contact: Contact,
  fromMe: boolean = false,
  isFlowbuilder: boolean = false
): Promise<void> => {
  if (ticket.channel === "oficial") {

    const messageData = {
      wid: msg.mid,
      ticketId: ticket.id,
      contactId: contact.id,
      body: msg.text || msg.media.originalname,
      fromMe: fromMe ? fromMe : msg.is_echo ? true : false,
      mediaType: msg.attachments[0].type,
      mediaUrl: isFlowbuilder ? msg.attachments[0].payload.url :  msg.media.filename,
      read: fromMe ? fromMe : msg.is_echo,
      quotedMsgId: null,
      ack: 2,
      dataJson: JSON.stringify(msg),
      channel: ticket.channel
    };    

    await CreateMessageService({ messageData, companyId: ticket.companyId });

    return;
  }

  
  const { data } = await axios.get(msg.attachments[0].payload.url, {
    responseType: "arraybuffer"
  });

  // eslint-disable-next-line no-eval
  const { fileTypeFromBuffer } = await (eval('import("file-type")') as Promise<
    typeof import("file-type")
  >);

  const type = await fileTypeFromBuffer(data);

  const fileName = `${new Date().getTime()}.${type.ext}`;

  const folder = `public/company${ticket.companyId}`;
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
    fs.chmodSync(folder, 0o777);
  }

  writeFileSync(
    join(__dirname, "..", "..", "..", folder, fileName),
    data,
    "base64"
  );

  const messageData = {
    wid: msg.mid,
    ticketId: ticket.id,
    contactId: fromMe ? undefined : msg.is_echo ? undefined : contact.id,
    body: msg.text || fileName,
    fromMe: fromMe ? fromMe : msg.is_echo ? true : false,
    mediaType: msg.attachments[0].type,
    mediaUrl: fileName,
    read: fromMe ? fromMe : msg.is_echo,
    quotedMsgId: null,
    ack: 3,
    dataJson: JSON.stringify(msg),
    channel: ticket.channel
  };

  await CreateMessageService({ messageData, companyId: ticket.companyId });

  // await ticket.update({
  //   lastMessage: msg.text
  // });
};

export const verifyQuotedMessage = async (
  msg: any
): Promise<Message | null> => {
  if (!msg) return null;
  const quoted = msg?.reply_to?.mid;

  if (!quoted) return null;

  const quotedMsg = await Message.findOne({
    where: { wid: quoted }
  });

  if (!quotedMsg) return null;

  return quotedMsg;
};

const flowBuilderQueue = async (
  ticket: Ticket,
  message: any,
  getSession: Whatsapp,
  companyId: number,
  contact: Contact,
  isFirstMsg: Ticket
) => {
  const flow = await FlowBuilderModel.findOne({
    where: {
      id: ticket.flowStopped
    }
  });

  const mountDataContact = {
    number: contact.number,
    name: contact.name,
    email: contact.email
  };

  console.log("======================================");
  console.log("|         flowBuilderQueue           |");
  console.log("======================================");

  const nodes: INodes[] = flow.flow["nodes"];
  const connections: IConnections[] = flow.flow["connections"];

  if (!ticket.lastFlowId) {
    return;
  }

  if (ticket.flowWebhook) {
    await ActionsWebhookFacebookService(
      getSession,
      parseInt(ticket.flowStopped),
      ticket.companyId,
      nodes,
      connections,
      ticket.lastFlowId,
      null,
      "",
      "",
      message.text,
      ticket.id,
      mountDataContact
    );
  }

  //const integrations = await ShowQueueIntegrationService(whatsapp.integrationId, companyId);
  //await handleMessageIntegration(msg, wbot, companyId, integrations, ticket, contact, isFirstMsg)
};

const handleMessageIntegration = async (
  msg: any,
  getSession: Whatsapp,
  companyId: any,
  queueIntegration: QueueIntegrations,
  ticket: Ticket,
  contact: Contact,
  isFirstMsg: Ticket | null,
) => {

  if(process.env.CHATBOT_RESTRICT_NUMBER){
    if(ticket.contact.number != process.env.CHATBOT_RESTRICT_NUMBER){
      console.log("chatbot desativado");
      return true;
    }
  }

  
  if (queueIntegration.type === "flowbuilder") {
      await flowbuilderIntegration(
        msg,
        getSession,
        companyId,
        queueIntegration,
        ticket,
        contact,
        isFirstMsg
      );
  }
  
}
const flowbuilderIntegration = async (
  msg: any,
  getSession: Whatsapp,
  companyId: any,
  queueIntegration: QueueIntegrations,
  ticket: Ticket,
  contact: Contact,
  isFirstMsg: Ticket
) => {
  

  const listPhrase = await FlowCampaignModel.findAll({
    where: {
      whatsappId: getSession.id
    }
  });

 
  const ticketUpdate = await ticket.update({
    lastMessage: msg.text
  });

    const dateTicket = new Date(isFirstMsg ? isFirstMsg.updatedAt : "");
    const dateNow = new Date();
    const diferencaEmMilissegundos = Math.abs(
      differenceInMilliseconds(dateTicket, dateNow)
    );
    const seisHorasEmMilissegundos = 2 * 1000;
  
    if (
      listPhrase.filter(item => item.phrase === msg.text).length === 0 &&
      isFirstMsg &&
      diferencaEmMilissegundos >= seisHorasEmMilissegundos &&
      !ticket.flowWebhook
    ) {

      console.log(442, "flowbuilderIntegration");

      const flow = await FlowBuilderModel.findOne({
        where: {
          id: getSession.flowIdNotPhrase
        }
      });
  
      if (flow) {
        const nodes: INodes[] = flow.flow["nodes"];
        const connections: IConnections[] = flow.flow["connections"];
  
        const mountDataContact = {
          number: contact.number,
          name: contact.name,
          email: contact.email
        };
  
        await ActionsWebhookWabaService(
          getSession,
          getSession.flowIdNotPhrase,
          ticket.companyId,
          nodes,
          connections,
          flow.flow["nodes"][0].id,
          null,
          "",
          "",
          null,
          ticket.id,
          mountDataContact
        );
      }
    }
  
    if (ticket.flowWebhook) {
  
      console.log("#2 webhook", ticketUpdate.flowStopped);

      const flow = await FlowBuilderModel.findOne({
        where: {
          id: ticketUpdate.flowStopped
        }
      });
  
      const nodes: INodes[] = flow.flow["nodes"];
      const connections: IConnections[] = flow.flow["connections"];
  
      const mountDataContact = {
        number: contact.number,
        name: contact.name,
        email: contact.email
      };
  
  
      await ActionsWebhookWabaService(
        getSession,
        parseInt(ticket.flowStopped),
        ticket.companyId,
        nodes,
        connections,
        ticketUpdate.lastFlowId,
        null,
        "",
        "",
        msg.text,
        ticket.id,
        mountDataContact,
      );
    }
  
};

export const verifyMessageWaba = async (
  msg: any,
  body: any,
  ticket: Ticket,
  contact: Contact,
  fromMe: boolean = false
) => {
  const quotedMsg = await verifyQuotedMessage(msg);

  const messageData = {
    wid: msg.mid,
    ticketId: ticket.id,
    contactId: fromMe ? undefined : msg.is_echo ? undefined : contact.id,
    body: body || msg.text,
    mediaType: "conversation",
    fromMe: fromMe ? fromMe : msg.is_echo ? true : false,
    read: false,
    quotedMsgId: quotedMsg?.id,
    ack: 2,
    dataJson: JSON.stringify(msg),
    channel: ticket.channel
  };

  await CreateMessageService({ messageData, companyId: ticket.companyId });
};

function httpsGet(
  url: string | URL,
  options: RequestOptions
): Promise<WWCustoResponse> {
  return new Promise((resolve, reject) => {
    get(url, options, res => {
      const newRes = res as WWCustoResponse;
      newRes.body = new ReadableStream({
        start(controller) {
          res.on("data", chunk => {
            controller.enqueue(chunk);
          });
          res.on("end", () => {
            controller.close();
          });
        }
      });
      resolve(newRes);
    }).on("error", e => {
      reject(e);
    });
  });
}

const fileRegex = /filename=.+\.(\w+)$/;
const getFileExtensionFromContentDisposition = (contentDisposition: string) => {
  const regexResult = fileRegex.exec(contentDisposition);
  if (regexResult) {
    return regexResult[1];
  }
  console.log(`${contentDisposition} could not be parsed`);
  return null;
};

async function saveReadableStreamToFile(
  stream: ReadableStream<Uint16Array>,
  filePath
) {
  const chunks = [];

  // Consumir o stream de forma assíncrona
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  // Converte os chunks para um buffer único
  const buffer = Buffer.concat(chunks);

  // Escreve o buffer no arquivo
  await writeFile(filePath, buffer);
}



export const verifyMessageWabaMedia = async (
  msg: any,
  message: TMessage,
  whatsapp: Whatsapp,
  ticket: Ticket,
  contact: Contact,
  fromMe: boolean = false,
  ticketTraking?: TicketTraking
) => {
  try {

    if(message?.type === "contacts"){
      // Extraindo os dados do contato
      const contact = message.contacts[0];
      const firstName = contact.name.first_name;
      const lastName = contact.name.last_name;
      const formattedName = contact.name.formatted_name;
      const numberContact = contact.phones[0].phone; // O número de telefone

      // Criando o vCard
      const vcard = `BEGIN:VCARD\n`
        + `VERSION:3.0\n`
        + `N:${lastName};${firstName};;;\n`
        + `FN:${formattedName}\n`
        + `TEL;type=CELL;waid=${contact.phones[0].wa_id}:${numberContact}\n`
        + `END:VCARD`;
       

        const messageData =  {
          wid: msg.mid,
          ticketId: ticket.id,
          contactId: ticket.contactId,
          body: vcard,
          fromMe: false,
          mediaType: "contactMessage",
          read: false,
          quotedMsgId: undefined,
          ack: 2,
          participant: undefined,
          isPrivate: false,
          ticketImported: null,
          isForwarded: false,
          channel: ticket.channel,
          ticketTrakingId: ticketTraking?.id,
        };

      await ticket.update({ lastMessage: vcard });

      await CreateMessageService({ messageData, companyId: ticket.companyId });
      
    }else {
      
      const response = await getWabaMediaUrl(
        whatsapp.officialAccessToken,
        message?.audio?.id || message?.video?.id || message?.image?.id || message?.document?.id || message?.sticker?.id
      );
  
      const headerOptions = {
        Authorization: `Bearer ${whatsapp.officialAccessToken}`,
        "User-Agent": "curl/7.84.0",
        Accept: "*/*"
      };
  
      const mediaReponse = await httpsGet(response.url, {
        headers: headerOptions
      });
  
      const mediaBody = mediaReponse.body;
      if (mediaBody) {
        const contentDispositio = mediaReponse.headers["content-disposition"];
        let extension;
  
        if (contentDispositio) {
          extension = getFileExtensionFromContentDisposition(contentDispositio);
        }
        if (!extension) {
          extension = "unknown";
        }
  
        const fileName = `${new Date().getTime()}.${extension}`;
  
        const folder = `public/company${ticket.companyId}`;
        if (!fs.existsSync(folder)) {
          fs.mkdirSync(folder);
          fs.chmodSync(folder, 0o777);
        }
  
        await saveReadableStreamToFile(
          mediaBody,
          join(__dirname, "..", "..", "..", folder, fileName)
        );
  
        const messageData = {
          wid: msg.mid,
          ticketId: ticket.id,
          contactId: fromMe ? undefined : msg.is_echo ? undefined : contact.id,
          body: fileName,
          fromMe: fromMe ? fromMe : msg.is_echo ? true : false,
          mediaType: message.type,
          mediaUrl: fileName,
          read: fromMe ? fromMe : msg.is_echo,
          quotedMsgId: null,
          ticketTrakingId: ticketTraking?.id,
          ack: 2,
          dataJson: JSON.stringify(msg),
          channel: ticket.channel
        };
  
        await ticket.update({
          lastMessage: fileName
        });
  
        await CreateMessageService({ messageData, companyId: ticket.companyId });
      }
      
    }
    
  } catch (err) {
    console.log(err);
  }
};


export const handleWabaMessage = async (
  token: Whatsapp,
  webhookEvent: any,
  channel: string,
  companyId: any
): Promise<any> => {
  try {
    let phon_no_id = webhookEvent.changes[0].value.metadata.phone_number_id;
    const phone_number_id =
      webhookEvent.changes[0].value.metadata.phone_number_id;
    const me = webhookEvent.changes[0].value.metadata.display_phone_number;
    const name = webhookEvent.changes[0].value.contacts[0].profile.name;
    const id = webhookEvent.changes[0].value.contacts[0].wa_id;
    const msgContact = {
      name,
      id,
      first_name: null,
      lastName: null,
      profile_pic: null
    };
    const message : TMessage = webhookEvent.changes[0].value.messages[0] as TMessage

    
    let body = message?.text?.body;

    const contact = await verifyContact(msgContact, token, companyId);

    const fromMe = me === contact.number;

    let msg = {
      mid: message.id,
      fromMe: false,
      is_echo: false,
      text: body
    };

    const unreadCount = 1;

    const getSession = await Whatsapp.findOne({
      where: {
        officialWppBusinessId: token.officialWppBusinessId
      },
      include: [
        {
          model: Queue,
          as: "queues",
          attributes: ["id", "name", "color", "greetingMessage"],
          include: [
            {
              model: Chatbot,
              as: "chatbots",
              attributes: ["id", "name", "greetingMessage"]
            }
          ]
        }
      ],
      order: [
        ["queues", "id", "ASC"],
        ["queues", "chatbots", "id", "ASC"]
      ]
    });


    const settings = await CompaniesSettings.findOne({
      where: { companyId }
    });

    const isFirstMsg = await Ticket.findOne({
      where: {
        contactId: contact.id,
        companyId
      },
      order: [["id", "DESC"]]
    });


    const mutex = new Mutex();
    const ticket = await mutex.runExclusive(async () => {
      const createTicket = await FindOrCreateTicketService(
        contact,
        getSession,
        unreadCount,
        companyId,
        0,
        0,
        null,
        channel,
        null,
        false,
        settings
      );
      return createTicket;
    });

    let bodyRollbackTag = "";
    let bodyNextTag = "";
    let rollbackTag;
    let nextTag;
    let ticketTag = undefined;

    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId,
      whatsappId: getSession?.id,
      userId: ticket.userId
    });

    if (
      (getSession.farewellMessage &&
        formatBody(getSession.farewellMessage, ticket) === body) ||
      (getSession.ratingMessage &&
        formatBody(getSession.ratingMessage, ticket) === body)
    )
      return;

    if (
      rollbackTag &&
      formatBody(bodyNextTag, ticket) !== body &&
      formatBody(bodyRollbackTag, ticket) !== body
    ) {
      await TicketTag.destroy({
        where: { ticketId: ticket.id, tagId: ticketTag.tagId }
      });
      await TicketTag.create({ ticketId: ticket.id, tagId: rollbackTag.id });
    }

    await ticket.update({
      lastMessage: body
    });

    try {
      if (!fromMe) {
        /**
         * Tratamento para avaliação do atendente
         */
        if (
          ticket.status === "nps" &&
          ticketTraking !== null &&
          verifyRating(ticketTraking)
        ) {
          if (!isNaN(parseFloat(body))) {
            handleRating(parseFloat(body), ticket, ticketTraking);

            await ticketTraking.update({
              ratingAt: moment().toDate(),
              finishedAt: moment().toDate(),
              rated: true
            });

            return;
          } else {
            if (ticket.amountUsedBotQueuesNPS < getSession.maxUseBotQueuesNPS) {
              let bodyErrorRating = `\u200eOpção inválida, tente novamente.\n`;
              const sentMessage = await sendText(
                contact.number,
                bodyErrorRating,
                getSession.facebookUserToken
              );

              await verifyMessageWaba(
                sentMessage,
                bodyErrorRating,
                ticket,
                contact
              );

              // await delay(1000);

              let bodyRatingMessage = `\u200e${getSession.ratingMessage}\n`;

              const msg = await sendText(
                contact.number,
                bodyRatingMessage,
                getSession.facebookUserToken
              );

              await verifyMessageFace(
                sentMessage,
                bodyRatingMessage,
                ticket,
                contact
              );

              await ticket.update({
                amountUsedBotQueuesNPS: ticket.amountUsedBotQueuesNPS + 1
              });
            }
            return;
          }
        }

        const enableLGPD = settings.enableLGPD === "enabled";

        //TRATAMENTO LGPD
        if (enableLGPD && ticket.status === "lgpd") {
          if (
            isNil(ticket.lgpdAcceptedAt) &&
            !isNil(ticket.lgpdSendMessageAt)
          ) {
            let choosenOption: number | null = null;

            if (!isNaN(parseFloat(body))) {
              choosenOption = parseFloat(body);
            }

            //Se digitou opção numérica
            if (
              !Number.isNaN(choosenOption) &&
              Number.isInteger(choosenOption) &&
              !isNull(choosenOption) &&
              choosenOption > 0
            ) {
              //Se digitou 1, aceitou o termo e vai pro bot
              if (choosenOption === 1) {
                await contact.update({
                  lgpdAcceptedAt: moment().toDate()
                });
                await ticket.update({
                  lgpdAcceptedAt: moment().toDate(),
                  amountUsedBotQueues: 0
                });
                //Se digitou 2, recusou o bot e encerra chamado
              } else if (choosenOption === 2) {
                if (
                  getSession.complationMessage !== "" &&
                  getSession.complationMessage !== undefined
                ) {
                  const sentMessage = await sendText(
                    contact.number,
                    `\u200e${getSession.complationMessage}`,
                    getSession.facebookUserToken
                  );

                  await verifyMessageFace(
                    sentMessage,
                    `\u200e${getSession.complationMessage}`,
                    ticket,
                    contact
                  );
                }

                await ticket.update({
                  status: "closed",
                  amountUsedBotQueues: 0
                });

                await ticketTraking.destroy;

                return;
                //se digitou qualquer opção que não seja 1 ou 2 limpa o lgpdSendMessageAt para
                //enviar de novo o bot respeitando o numero máximo de vezes que o bot é pra ser enviado
              } else {
                if (ticket.amountUsedBotQueues < getSession.maxUseBotQueues) {
                  await ticket.update({
                    amountUsedBotQueues: ticket.amountUsedBotQueues + 1,
                    lgpdSendMessageAt: null
                  });
                }
              }
              //se digitou qualquer opção que não número o lgpdSendMessageAt para
              //enviar de novo o bot respeitando o numero máximo de vezes que o bot é pra ser enviado
            } else {
              if (ticket.amountUsedBotQueues < getSession.maxUseBotQueues) {
                await ticket.update({
                  amountUsedBotQueues: ticket.amountUsedBotQueues + 1,
                  lgpdSendMessageAt: null
                });
              }
            }
          }

          if (
            (contact.lgpdAcceptedAt === null ||
              settings?.lgpdConsent === "enabled") &&
            !contact.isGroup &&
            isNil(ticket.lgpdSendMessageAt) &&
            ticket.amountUsedBotQueues <= getSession.maxUseBotQueues &&
            !isNil(settings?.lgpdMessage)
          ) {
            await verifyMessageFace(msg, body, ticket, contact);

            if (!isNil(settings?.lgpdMessage) && settings.lgpdMessage !== "") {
              const bodyMessageLGPD = formatBody(
                `\u200e${settings.lgpdMessage}`,
                ticket
              );

              const sentMessage = await sendWabaMessageService({
                body: bodyMessageLGPD,
                ticket:  ticket,
              });

              await verifyMessageWaba(
                sentMessage,
                bodyMessageLGPD,
                ticket,
                contact
              );
            }
            // await delay(1000);

            if (!isNil(settings?.lgpdLink) && settings?.lgpdLink !== "") {
              const bodyLink = formatBody(`\u200e${settings.lgpdLink}`, ticket);
              const sentMessage = await sendText(
                contact.number,
                bodyLink,
                getSession.facebookUserToken
              );

              await verifyMessageWaba(sentMessage, bodyLink, ticket, contact);
            }

            // await delay(1000);

            const bodyBot = formatBody(
              `\u200eEstou ciente sobre o tratamento dos meus dados pessoais. \n\n[1] Sim\n[2] Não`,
              ticket
            );

            const sentMessageBot = await sendWabaMessageService({
              body: contact.number,
              ticket: ticket
            });

            await verifyMessageWaba(sentMessageBot, bodyBot, ticket, contact);

            await ticket.update({
              lgpdSendMessageAt: moment().toDate(),
              amountUsedBotQueues: ticket.amountUsedBotQueues + 1
            });

            await ticket.reload();

            return;
          }

          if (!isNil(ticket.lgpdSendMessageAt) && isNil(ticket.lgpdAcceptedAt))
            return;
        }
      }
    } catch (e) {
      throw new Error(e);
      console.log(e);
    }
    console.log(1114, "handleWabaMessage", message, msg);
    if (["video", "image", "audio", "document", "sticker", "contacts"].includes(message?.type)) {
      
      await verifyMessageWabaMedia(
        msg,
        message,
        token,
        ticket,
        contact,
        false,
        ticketTraking
      );
      
    } else {
      await verifyMessageWaba(
        msg,
        body,
        ticket,
        contact,
        false,
      );
    }


    //console.log(1096, "facebookMessageListener", ticket);

    if(
      !ticket.imported &&
      !ticket.isGroup &&
      !ticket.queue &&
      !ticket.user &&
      !contact.disableBot &&
      (ticket.useIntegration || ticket.flowWebhook || !isNil(getSession.integrationId))

    ){

      const integrations = await ShowQueueIntegrationService(
        getSession.integrationId,
        companyId
      )

      console.log(" Entrei na integração flowbuilder/2");

      await handleMessageIntegration(
        msg,
        getSession,
        companyId,
        integrations,
        ticket,
        contact,
        isFirstMsg
      )
    }

    
    if (
      !ticket.queue &&
      !ticket.userId &&
      getSession.queues.length >= 1
    ) {
      await verifyQueue(getSession, msg, ticket, contact);
    }

    if (ticket.queue && ticket.queueId) {
      if (!ticket.user) {
        await sayChatbot(ticket.queueId, getSession, ticket, contact, msg);
      }
    }
    return;
  } catch (error) {
    throw new Error(error);
  }
};

export const handleMessage = async (
  token: Whatsapp,
  webhookEvent: any,
  channel: string,
  companyId: any
): Promise<any> => {
  try {
    if (webhookEvent.message) {
      let msgContact: any;

      const senderPsid = webhookEvent.sender.id;
      const recipientPsid = webhookEvent.recipient.id;
      const { message } = webhookEvent;
      const fromMe = message.is_echo;

      let bodyMessage = message.text;

      if (fromMe) {
        if (/\u200e/.test(bodyMessage)) return;

        msgContact = await profilePsid(recipientPsid, token.facebookUserToken);
      } else {
        msgContact = await profilePsid(senderPsid, token.facebookUserToken);
      }

      const contact = await verifyContact(msgContact, token, companyId);

      const unreadCount = fromMe ? 0 : 1;

      const getSession = await Whatsapp.findOne({
        where: {
          facebookPageUserId: token.facebookPageUserId
        },
        include: [
          {
            model: Queue,
            as: "queues",
            attributes: ["id", "name", "color", "greetingMessage"],
            include: [
              {
                model: Chatbot,
                as: "chatbots",
                attributes: ["id", "name", "greetingMessage"]
              }
            ]
          }
        ],
        order: [
          ["queues", "id", "ASC"],
          ["queues", "chatbots", "id", "ASC"]
        ]
      });

      const settings = await CompaniesSettings.findOne({
        where: { companyId }
      });

      const isFirstMsg = await Ticket.findOne({
        where: {
          contactId: contact.id,
          companyId
        },
        order: [["id", "DESC"]]
      });

      const mutex = new Mutex();
      const ticket = await mutex.runExclusive(async () => {
        const createTicket = await FindOrCreateTicketService(
          contact,
          getSession,
          unreadCount,
          companyId,
          0,
          0,
          null,
          channel,
          null,
          false,
          settings
        );
        return createTicket;
      });

      let bodyRollbackTag = "";
      let bodyNextTag = "";
      let rollbackTag;
      let nextTag;
      let ticketTag = undefined;
      // console.log(ticket.id)
      if (ticket?.company?.plan?.useKanban) {
        ticketTag = await TicketTag.findOne({
          where: {
            ticketId: ticket.id
          }
        });

        if (ticketTag) {
          const tag = await Tag.findByPk(ticketTag.tagId);

          if (tag.nextLaneId) {
            nextTag = await Tag.findByPk(tag.nextLaneId);

            bodyNextTag = nextTag.greetingMessageLane;
          }
          if (tag.rollbackLaneId) {
            rollbackTag = await Tag.findByPk(tag.rollbackLaneId);

            bodyRollbackTag = rollbackTag.greetingMessageLane;
          }
        }
      }

      const ticketTraking = await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        whatsappId: getSession?.id,
        userId: ticket.userId
      });

      if (
        (getSession.farewellMessage &&
          formatBody(getSession.farewellMessage, ticket) === message.text) ||
        (getSession.ratingMessage &&
          formatBody(getSession.ratingMessage, ticket) === message.text)
      )
        return;

      if (
        rollbackTag &&
        formatBody(bodyNextTag, ticket) !== bodyMessage &&
        formatBody(bodyRollbackTag, ticket) !== bodyMessage
      ) {
        await TicketTag.destroy({
          where: { ticketId: ticket.id, tagId: ticketTag.tagId }
        });
        await TicketTag.create({ ticketId: ticket.id, tagId: rollbackTag.id });
      }

      await ticket.update({
        lastMessage: message.text
      });

      try {
        if (!fromMe) {
          /**
           * Tratamento para avaliação do atendente
           */
          if (
            ticket.status === "nps" &&
            ticketTraking !== null &&
            verifyRating(ticketTraking)
          ) {
            if (!isNaN(parseFloat(bodyMessage))) {
              handleRating(parseFloat(bodyMessage), ticket, ticketTraking);

              await ticketTraking.update({
                ratingAt: moment().toDate(),
                finishedAt: moment().toDate(),
                rated: true
              });

              return;
            } else {
              if (
                ticket.amountUsedBotQueuesNPS < getSession.maxUseBotQueuesNPS
              ) {
                let bodyErrorRating = `\u200eOpção inválida, tente novamente.\n`;
                const sentMessage = await sendText(
                  contact.number,
                  bodyErrorRating,
                  getSession.facebookUserToken
                );

                await verifyMessageFace(
                  sentMessage,
                  bodyErrorRating,
                  ticket,
                  contact
                );

                // await delay(1000);

                let bodyRatingMessage = `\u200e${getSession.ratingMessage}\n`;

                const msg = await sendText(
                  contact.number,
                  bodyRatingMessage,
                  getSession.facebookUserToken
                );

                await verifyMessageFace(
                  sentMessage,
                  bodyRatingMessage,
                  ticket,
                  contact
                );

                await ticket.update({
                  amountUsedBotQueuesNPS: ticket.amountUsedBotQueuesNPS + 1
                });
              }
              return;
            }
          }

          const enableLGPD = settings.enableLGPD === "enabled";

          //TRATAMENTO LGPD
          if (enableLGPD && ticket.status === "lgpd") {
            if (
              isNil(ticket.lgpdAcceptedAt) &&
              !isNil(ticket.lgpdSendMessageAt)
            ) {
              let choosenOption: number | null = null;

              if (!isNaN(parseFloat(bodyMessage))) {
                choosenOption = parseFloat(bodyMessage);
              }

              //Se digitou opção numérica
              if (
                !Number.isNaN(choosenOption) &&
                Number.isInteger(choosenOption) &&
                !isNull(choosenOption) &&
                choosenOption > 0
              ) {
                //Se digitou 1, aceitou o termo e vai pro bot
                if (choosenOption === 1) {
                  await contact.update({
                    lgpdAcceptedAt: moment().toDate()
                  });
                  await ticket.update({
                    lgpdAcceptedAt: moment().toDate(),
                    amountUsedBotQueues: 0
                  });
                  //Se digitou 2, recusou o bot e encerra chamado
                } else if (choosenOption === 2) {
                  if (
                    getSession.complationMessage !== "" &&
                    getSession.complationMessage !== undefined
                  ) {
                    const sentMessage = await sendText(
                      contact.number,
                      `\u200e${getSession.complationMessage}`,
                      getSession.facebookUserToken
                    );

                    await verifyMessageFace(
                      sentMessage,
                      `\u200e${getSession.complationMessage}`,
                      ticket,
                      contact
                    );
                  }

                  await ticket.update({
                    status: "closed",
                    amountUsedBotQueues: 0
                  });

                  await ticketTraking.destroy;

                  return;
                  //se digitou qualquer opção que não seja 1 ou 2 limpa o lgpdSendMessageAt para
                  //enviar de novo o bot respeitando o numero máximo de vezes que o bot é pra ser enviado
                } else {
                  if (ticket.amountUsedBotQueues < getSession.maxUseBotQueues) {
                    await ticket.update({
                      amountUsedBotQueues: ticket.amountUsedBotQueues + 1,
                      lgpdSendMessageAt: null
                    });
                  }
                }
                //se digitou qualquer opção que não número o lgpdSendMessageAt para
                //enviar de novo o bot respeitando o numero máximo de vezes que o bot é pra ser enviado
              } else {
                if (ticket.amountUsedBotQueues < getSession.maxUseBotQueues) {
                  await ticket.update({
                    amountUsedBotQueues: ticket.amountUsedBotQueues + 1,
                    lgpdSendMessageAt: null
                  });
                }
              }
            }

            if (
              (contact.lgpdAcceptedAt === null ||
                settings?.lgpdConsent === "enabled") &&
              !contact.isGroup &&
              isNil(ticket.lgpdSendMessageAt) &&
              ticket.amountUsedBotQueues <= getSession.maxUseBotQueues &&
              !isNil(settings?.lgpdMessage)
            ) {
              if (message.attachments) {
                await verifyMessageMedia(message, ticket, contact);
              } else {
                await verifyMessageFace(message, message.text, ticket, contact);
              }

              if (
                !isNil(settings?.lgpdMessage) &&
                settings.lgpdMessage !== ""
              ) {
                const bodyMessageLGPD = formatBody(
                  `\u200e${settings.lgpdMessage}`,
                  ticket
                );

                const sentMessage = await sendText(
                  contact.number,
                  bodyMessageLGPD,
                  getSession.facebookUserToken
                );

                await verifyMessageFace(
                  sentMessage,
                  bodyMessageLGPD,
                  ticket,
                  contact
                );
              }
              // await delay(1000);

              if (!isNil(settings?.lgpdLink) && settings?.lgpdLink !== "") {
                const bodyLink = formatBody(
                  `\u200e${settings.lgpdLink}`,
                  ticket
                );
                const sentMessage = await sendText(
                  contact.number,
                  bodyLink,
                  getSession.facebookUserToken
                );

                await verifyMessageFace(sentMessage, bodyLink, ticket, contact);
              }

              // await delay(1000);

              const bodyBot = formatBody(
                `\u200eEstou ciente sobre o tratamento dos meus dados pessoais. \n\n[1] Sim\n[2] Não`,
                ticket
              );

              const sentMessageBot = await sendText(
                contact.number,
                bodyBot,
                getSession.facebookUserToken
              );

              await verifyMessageFace(sentMessageBot, bodyBot, ticket, contact);

              await ticket.update({
                lgpdSendMessageAt: moment().toDate(),
                amountUsedBotQueues: ticket.amountUsedBotQueues + 1
              });

              await ticket.reload();

              return;
            }

            if (
              !isNil(ticket.lgpdSendMessageAt) &&
              isNil(ticket.lgpdAcceptedAt)
            )
              return;
          }
        }
      } catch (e) {
        throw new Error(e);
        console.log(e);
      }

      if (message.attachments) {
        await verifyMessageMedia(message, ticket, contact);
      } else {
        await verifyMessageFace(message, message.text, ticket, contact);
      }

      if(
        !ticket.imported &&
        !ticket.isGroup &&
        !ticket.queue &&
        !ticket.user &&
        !contact.disableBot &&
        (ticket.useIntegration || ticket.flowWebhook || !isNil(getSession.integrationId))

      ){

        const integrations = await ShowQueueIntegrationService(
          getSession.integrationId,
          companyId
        )

        console.log(" Entrei na integração flowbuilder/2");

        await handleMessageIntegration(
          message,
          getSession,
          companyId,
          integrations,
          ticket,
          contact,
          isFirstMsg
        )
      }
      /*
      const flow = await FlowBuilderModel.findOne({
        where: {
          id: ticket.flowStopped
        }
      });

      let isMenu = false;
      if (flow) {
        isMenu =
          flow.flow["nodes"].find((node: any) => node.id === ticket.lastFlowId)
            ?.type === "menu";
      }

      console.log({ ticket });

      if (!ticket.fromMe && isMenu && !isNaN(message.text)) {
        await ticket.update({
          queueId: ticket.queueId ? ticket.queueId : null
        });

        await flowBuilderQueue(
          ticket,
          message,
          getSession,
          companyId,
          contact,
          isFirstMsg
        );
      }

      if (
        !ticket.imported &&
        !fromMe &&
        !ticket.isGroup &&
        !ticket.queue &&
        !ticket.user &&
        !isMenu &&
        (!ticket.dataWebhook || ticket.dataWebhook["status"] === "stopped") &&
        // ticket.isBot &&
        !isNil(getSession.integrationId) &&
        !ticket.useIntegration
      ) {
        const integrations = await ShowQueueIntegrationService(
          getSession.integrationId,
          companyId
        );

        if (integrations.type === "flowbuilder") {
          await ticket.update({
            queueId: ticket.queueId ? ticket.queueId : null,
            dataWebhook: {
              status: "process"
            }
          });

          await flowbuilderIntegration(
            ticket,
            companyId,
            isFirstMsg,
            getSession,
            contact,
            message
          );
        }
      }
      */

      if (
        !ticket.queue &&
        !fromMe &&
        !ticket.userId &&
        getSession.queues.length >= 1
      ) {
        await verifyWabaQueue(getSession, message, ticket, contact);
      }

      if (ticket.queue && ticket.queueId) {
        if (!ticket.user) {
          await sayChatbot(
            ticket.queueId,
            getSession,
            ticket,
            contact,
            message
          );
        }
      }
    }

    return;
  } catch (error) {
    throw new Error(error);
  }
};

const verifyWabaQueue = async (
  getSession: Whatsapp,
  msg: any,
  ticket: Ticket,
  contact: Contact
) => {

  // console.log("VERIFYING QUEUE", ticket.whatsappId, getSession.id)
  const { queues, greetingMessage } = await ShowWhatsAppService(
    getSession.id!,
    ticket.companyId
  );

  if (queues.length === 1) {
    const firstQueue = head(queues);
    let chatbot = false;
    if (firstQueue?.chatbots) {
      chatbot = firstQueue?.chatbots?.length > 0;
    }
    await UpdateTicketService({
      ticketData: { queueId: queues[0].id, isBot: chatbot },
      ticketId: ticket.id,
      companyId: ticket.companyId
    });

    return;
  }

  let selectedOption = "";

  if (ticket.status !== "lgpd") {
    selectedOption = msg.text;
  } else {
    if (!isNil(ticket.lgpdAcceptedAt))
      await ticket.update({
        status: "pending"
      });

    await ticket.reload();
  }

  const choosenQueue = queues[+selectedOption - 1];

  if (choosenQueue) {
    console.log(585, "facebookMessageListener");

    await UpdateTicketService({
      ticketData: { queueId: choosenQueue.id },
      ticketId: ticket.id,
      companyId: ticket.companyId
    });

    if (choosenQueue.chatbots.length > 0) {
      let options = "";
      choosenQueue.chatbots.forEach((chatbot, index) => {
        options += `[${index + 1}] - ${chatbot.name}\n`;
      });

      const body = `${choosenQueue.greetingMessage}\n\n${options}\n[#] Voltar para o menu principal`;

      const sentMessage = await sendWabaMessageService({
        ticket,
        body: body
      });

    }

    if (!choosenQueue.chatbots.length) {
      const body = `${choosenQueue.greetingMessage}`;

      const sentMessage = await sendWabaMessageService({
        ticket,
        body: body
      });
      // const debouncedSentChatbot = debounce(
      //   async () => { await sendText(
      //   contact.number,
      //   formatBody(body, ticket),
      //   ticket.whatsapp.facebookUserToken
      // );

      //   },
      //   3000,
      //   ticket.id
      // );
      // debouncedSentChatbot();
      // return await verifyMessage(msg, body, ticket, contact);
    }
  } else {
    let options = "";

    queues.forEach((queue, index) => {
      options += `[${index + 1}] - ${queue.name}\n`;
    });

    const body = `${greetingMessage}\n\n${options}`;

    const sentMessage = await sendWabaMessageService({
      ticket,
      body: body
    });
  }

}
const verifyQueue = async (
  getSession: Whatsapp,
  msg: any,
  ticket: Ticket,
  contact: Contact
) => {
  // console.log("VERIFYING QUEUE", ticket.whatsappId, getSession.id)
  const { queues, greetingMessage } = await ShowWhatsAppService(
    getSession.id!,
    ticket.companyId
  );

  if (queues.length === 1) {
    const firstQueue = head(queues);
    let chatbot = false;
    if (firstQueue?.chatbots) {
      chatbot = firstQueue?.chatbots?.length > 0;
    }
    await UpdateTicketService({
      ticketData: { queueId: queues[0].id, isBot: chatbot },
      ticketId: ticket.id,
      companyId: ticket.companyId
    });

    return;
  }

  let selectedOption = "";

  if (ticket.status !== "lgpd") {
    selectedOption = msg.text;
  } else {
    if (!isNil(ticket.lgpdAcceptedAt))
      await ticket.update({
        status: "pending"
      });

    await ticket.reload();
  }

  const choosenQueue = queues[+selectedOption - 1];

  if (choosenQueue) {
    console.log(585, "facebookMessageListener");

    await UpdateTicketService({
      ticketData: { queueId: choosenQueue.id },
      ticketId: ticket.id,
      companyId: ticket.companyId
    });

    if (choosenQueue.chatbots.length > 0) {
      let options = "";
      choosenQueue.chatbots.forEach((chatbot, index) => {
        options += `[${index + 1}] - ${chatbot.name}\n`;
      });

      const body = `${choosenQueue.greetingMessage}\n\n${options}\n[#] Voltar para o menu principal`;

      const sentMessage = await sendFacebookMessage({
        ticket,
        body: body
      });

      // const debouncedSentChatbot = debounce(
      //   async () => {
      //     await sendText(
      //   contact.number,
      //   formatBody(body, ticket),
      //   ticket.whatsapp.facebookUserToken
      // );
      //   },
      //   3000,
      //   ticket.id
      // );
      // debouncedSentChatbot();

      // return await verifyMessage(msg, body, ticket, contact);
    }

    if (!choosenQueue.chatbots.length) {
      const body = `${choosenQueue.greetingMessage}`;

      const sentMessage = await sendFacebookMessage({
        ticket,
        body: body
      });
      // const debouncedSentChatbot = debounce(
      //   async () => { await sendText(
      //   contact.number,
      //   formatBody(body, ticket),
      //   ticket.whatsapp.facebookUserToken
      // );

      //   },
      //   3000,
      //   ticket.id
      // );
      // debouncedSentChatbot();
      // return await verifyMessage(msg, body, ticket, contact);
    }
  } else {
    let options = "";

    queues.forEach((queue, index) => {
      options += `[${index + 1}] - ${queue.name}\n`;
    });

    const body = `${greetingMessage}\n\n${options}`;

    const sentMessage = await sendFacebookMessage({
      ticket,
      body: body
    });
    // const debouncedSentChatbot = debounce(
    //   async () => { await
    //     sendText(
    //       contact.number,
    //       formatBody(body, ticket),
    //       ticket.whatsapp.facebookUserToken
    //     );
    //   },
    //   3000,
    //   ticket.id
    // );
    // debouncedSentChatbot();

    // return verifyMessage(msg, body, ticket, contact);
  }
};
