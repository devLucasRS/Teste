import Chatbot from "../../../../models/Chatbot";
import Contact from "../../../../models/Contact";
import Queue from "../../../../models/Queue";
import Ticket from "../../../../models/Ticket";
import Whatsapp from "../../../../models/Whatsapp";
import ShowTicketService from "../../../TicketServices/ShowTicketService";
import {
  IConnections,
  INodes
} from "../../../WebhookService/DispatchWebHookService";
import {
  getAccessToken,
  sendAttachmentFromUrl,
  sendText,
  sendWabaMesage,
  showTypingIndicator
} from "../../graphAPI";
import formatBody from "../../../../helpers/Mustache";
import axios from "axios";
import fs from "fs";
import mime from "mime";
import path from "path";
import { getIO } from "../../../../libs/socket";
import { randomizarCaminho } from "../../../../utils/randomizador";
import CreateLogTicketService from "../../../TicketServices/CreateLogTicketService";
import UpdateTicketService from "../../../TicketServices/UpdateTicketService";
import FindOrCreateATicketTrakingService from "../../../TicketServices/FindOrCreateATicketTrakingService";
import ShowQueueService from "../../../QueueService/ShowQueueService";
import ffmpeg from "fluent-ffmpeg";
import { fi } from "date-fns/locale";
import queue from "../../../../libs/queue";
import sendWabaMessageService from "../sendWabaMessageService";
import { sendWabaMessageMediaService } from "../sendWabaMessageMidia";
import { verifyMessageMedia } from "../../facebookMessageListener";
import SetTicketMessagesAsRead from "../../../../helpers/SetTicketMessagesAsRead";
import CompaniesSettings from "../../../../models/CompaniesSettings";
import { handleOpenAi } from "../../../IntegrationsServices/OpenAiService";
import { IOpenAi } from "../../../../@types/openai";
import { proto } from "@whiskeysockets/baileys";
import User from "../../../../models/User";
const os = require("os");

let ffmpegPath;
if (os.platform() === "win32") {
  // Windows
  ffmpegPath = "C:\\ffmpeg\\ffmpeg.exe"; // Substitua pelo caminho correto no Windows
} else if (os.platform() === "darwin") {
  // macOS
  ffmpegPath = "/opt/homebrew/bin/ffmpeg"; // Substitua pelo caminho correto no macOS
} else {
  // Outros sistemas operacionais (Linux, etc.)
  ffmpegPath = "/usr/bin/ffmpeg"; // Substitua pelo caminho correto em sistemas Unix-like
}
ffmpeg.setFfmpegPath(ffmpegPath);

const getFileSize = (mediaPath: string) => {
  // 3. Obter o tamanho do arquivo
  const stats = fs.statSync(mediaPath); // Obtém estatísticas do arquivo
  return stats.size; // Tamanho em bytes
};

interface IAddContact {
  companyId: number;
  name: string;
  phoneNumber: string;
  email?: string;
  dataMore?: any;
}

interface NumberPhrase {
  number: string;
  name: string;
  email: string;
}

export const ActionsWebhookWabaService = async (
  token: Whatsapp,
  idFlowDb: number,
  companyId: number,
  nodes: INodes[],
  connects: IConnections[],
  nextStage: string,
  dataWebhook: any,
  details: any,
  hashWebhookId: string,
  pressKey?: string,
  idTicket?: number,
  numberPhrase: "" | { number: string; name: string; email: string } = ""
): Promise<string> => {
  const io = getIO();
  let next = nextStage;
  console.log(
    "ActionWebhookService | 53",
    idFlowDb,
    companyId,
    nodes,
    connects,
    nextStage,
    dataWebhook,
    details,
    hashWebhookId,
    pressKey,
    idTicket,
    numberPhrase
  );
  let createFieldJsonName = "";

  const connectStatic = connects;
  if (numberPhrase === "") {
    const nameInput = details.inputs.find(item => item.keyValue === "nome");
    nameInput.data.split(",").map(dataN => {
      const lineToData = details.keysFull.find(item => item === dataN);
      let sumRes = "";
      if (!lineToData) {
        sumRes = dataN;
      } else {
        sumRes = constructJsonLine(lineToData, dataWebhook);
      }
      createFieldJsonName = createFieldJsonName + sumRes;
    });
  } else {
    createFieldJsonName = numberPhrase.name;
  }

  let numberClient = "";

  let createFieldJsonEmail = "";

  if (numberPhrase === "") {
    const emailInput = details.inputs.find(item => item.keyValue === "email");
    emailInput.data.split(",").map(dataN => {
      const lineToDataEmail = details.keysFull.find(item =>
        item.endsWith("email")
      );

      let sumRes = "";
      if (!lineToDataEmail) {
        sumRes = dataN;
      } else {
        sumRes = constructJsonLine(lineToDataEmail, dataWebhook);
      }

      createFieldJsonEmail = createFieldJsonEmail + sumRes;
    });
  } else {
    createFieldJsonEmail = numberPhrase.email;
  }

  const lengthLoop = nodes.length;
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

  let execCount = 0;

  let execFn = "";

  let ticket = null;

  let noAlterNext = false;

  let selectedQueueid = null;

  for (var i = 0; i < lengthLoop; i++) {
    let nodeSelected: any;
    let ticketInit: Ticket;

    if (pressKey) {
      console.log("UPDATE2...");
      if (pressKey === "parar") {
        console.log("UPDATE3...");
        if (idTicket) {
          console.log("UPDATE4...");
          ticketInit = await Ticket.findOne({
            where: { id: idTicket }
          });
          await ticket.update({
            status: "closed"
          });
        }
        break;
      }

      if (execFn === "") {
        console.log("UPDATE5...");
        console.log(nodes.find((node: any) => node.id === nextStage));
        const isQuestion =
          nodes.find((node: any) => node.id === nextStage)?.type === "question";
        const isTypebot =
          nodes.find((node: any) => node.id === nextStage)?.type === "typebot";
        if (isQuestion) {
          nodeSelected = {
            type: "question"
          };
        } else if (isTypebot) {
          nodeSelected = {
            type: "typebot"
          };
        } else {
          nodeSelected = {
            type: "menu"
          };
        }
      } else {
        console.log("UPDATE6...");
        nodeSelected = nodes.filter(node => node.id === execFn)[0];
      }
    } else {
      console.log("UPDATE7...");
      const otherNode = nodes.filter(node => node.id === next)[0];
      if (otherNode) {
        nodeSelected = otherNode;
      }
    }

    let isQuestion: boolean;
    let isSwitchFlow: boolean;
    let flow: INodes = null;

    if (nodeSelected.type === "openai") {
      let {
        name,
        prompt,
        voice,
        voiceKey,
        voiceRegion,
        maxTokens,
        temperature,
        apiKey,
        queueId,
        maxMessages
      } = nodeSelected.data.typebotIntegration as IOpenAi;

      let openAiSettings = {
        name,
        prompt,
        voice,
        voiceKey,
        voiceRegion,
        maxTokens: parseInt(maxTokens),
        temperature: parseInt(temperature),
        apiKey,
        queueId: parseInt(queueId),
        maxMessages: parseInt(maxMessages)
      };

      const ticketDetails = await ShowTicketService(ticket.id, companyId);

      const ticketTraking = await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        userId: null,
        whatsappId: getSession?.id
      });

      const msg = {
        message: {
          conversation: pressKey
        }
      } as proto.IWebMessageInfo;

      await handleOpenAi(
        openAiSettings,
        msg,
        null,
        ticketDetails,
        ticketDetails.contact,
        null,
        ticketTraking
      );
    }

    if (nodeSelected.type === "question") {
      console.log(527, "question", pressKey, execFn);

      if (pressKey) {
        const currenNode = nodes.find(nd => nd.id === nextStage);
        const data = currenNode.data?.typebotIntegration;
        const answerKey = data["answerKey"];
        if (ticket) {
          ticket = await Ticket.findOne({
            where: {
              id: ticket.id
            },
            include: [
              { model: Contact, as: "contact", attributes: ["id", "name"] }
            ]
          });
        } else {
          ticket = await Ticket.findOne({
            where: {
              id: idTicket
            },
            include: [
              { model: Contact, as: "contact", attributes: ["id", "name"] }
            ]
          });
        }
        if (ticket) {
          await ticket.update({
            dataWebhook: {
              variables: {
                [answerKey]: pressKey
              }
            }
          });
        }
        const nextNode = connects.find(node => node.source === next);
        console.log(355, { nextNode });
        if (nextNode) {
          execFn = nextNode.target;
        } else {
          execFn = undefined;
        }
        if (execFn === undefined) {
          break;
        }
        // pressKey = "999";
        const isNodeExist = nodes.filter(item => item.id === execFn);
        if (isNodeExist.length > 0) {
          isQuestion = true;
        } else {
          isQuestion = false;
        }
      } else {
        const { message, answerKey } = nodeSelected.data.typebotIntegration;

        const ticketDetails = await ShowTicketService(idTicket, companyId);

        await sendWabaMessageService({
          body: message,
          ticket: ticketDetails,
          quotedMsg: null
        });

        SetTicketMessagesAsRead(ticketDetails);

        await ticketDetails.update({
          lastMessage: formatBody(message, ticket.contact)
        });
        if (ticket) {
          ticket = await Ticket.findOne({
            where: {
              id: ticket.id
            },
            include: [
              { model: Contact, as: "contact", attributes: ["id", "name"] }
            ]
          });
        } else {
          ticket = await Ticket.findOne({
            where: {
              id: idTicket
            },
            include: [
              { model: Contact, as: "contact", attributes: ["id", "name"] }
            ]
          });
        }
        if (ticket) {
          await ticket.update({
            queueId: ticket.queueId ? ticket.queueId : null,
            userId: null,
            companyId: companyId,
            flowWebhook: true,
            lastFlowId: nodeSelected.id,
            hashFlowId: hashWebhookId,
            flowStopped: idFlowDb.toString()
          });
        }
        break;
      }
    }

    if (nodeSelected.type === "ticket") {
      const { queue } = nodeSelected.data;

      const queueSelected = await ShowQueueService(queue.id, companyId);
  
      await ticket.update({
        status: "pending",
        queueId: queueSelected.id,
        userId: ticket.userId,
        companyId: companyId,
        flowWebhook: true,
        lastFlowId: nodeSelected.id,
        hashFlowId: hashWebhookId,
        flowStopped: idFlowDb.toString()
      });

      await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        whatsappId: ticket.whatsappId,
        userId: ticket.userId
      });

      await UpdateTicketService({
        ticketData: {
          status: "pending",
          queueId: queue.id
        },
        ticketId: ticket.id,
        companyId
      });

      await CreateLogTicketService({
        ticketId: ticket.id,
        type: "queue",
        queueId: queue.id
      });

      let settings = await CompaniesSettings.findOne({
        where: {
          companyId: companyId
        }
      });

      const enableQueuePosition = settings.sendQueuePosition === "enabled";

      if (enableQueuePosition) {
        const count = await Ticket.findAndCountAll({
          where: {
            userId: null,
            status: "pending",
            companyId,
            queueId: queue.id,
            whatsappId: getSession.id,
            isGroup: false
          }
        });

        // Lógica para enviar posição da fila de atendimento
        const qtd = count.count === 0 ? 1 : count.count;

        const msgFila = `${settings.sendQueuePositionMessage} *${qtd}*`;

        const ticketDetails = await ShowTicketService(ticket.id, companyId);

        const bodyFila = formatBody(`${msgFila}`, ticket.contact);


        await sendWabaMessageService({
          body: bodyFila,
          vCard: null,
          ticket: ticketDetails,
          quotedMsg: null
        });

        SetTicketMessagesAsRead(ticketDetails);

        await ticketDetails.update({
          lastMessage: bodyFila
        });
      }
    }

    if (nodeSelected.type === "singleBlock") {
      for (var iLoc = 0; iLoc < nodeSelected.data.seq.length; iLoc++) {
        const elementNowSelected = nodeSelected.data.seq[iLoc];
        console.log(elementNowSelected, "elementNowSelected");

        if (elementNowSelected.includes("message")) {
          // await SendMessageFlow(whatsapp, {
          //   number: numberClient,
          //   body: nodeSelected.data.elements.filter(
          //     item => item.number === elementNowSelected
          //   )[0].value
          // });
          const bodyFor = nodeSelected.data.elements.filter(
            item => item.number === elementNowSelected
          )[0].value;

          const ticketDetails = await ShowTicketService(ticket.id, companyId);

          await intervalWhats("5");

          console.log(189, "ActionsWebhookWabaService", ticket, ticketDetails);

          await sendWabaMessageService({
            body: bodyFor,
            vCard: null,
            ticket: ticketDetails,
            quotedMsg: null
          });
          await updateQueueId(ticket, companyId, selectedQueueid);

          await intervalWhats("1");
        }

        if (elementNowSelected.includes("interval")) {
          await intervalWhats(
            nodeSelected.data.elements.filter(
              item => item.number === elementNowSelected
            )[0].value
          );
        }

        if (elementNowSelected.includes("img")) {
          const mediaPath =
            process.env.BACKEND_URL === "http://localhost:8090"
              ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
                  nodeSelected.data.elements.filter(
                    item => item.number === elementNowSelected
                  )[0].value
                }`
              : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
                  nodeSelected.data.elements.filter(
                    item => item.number === elementNowSelected
                  )[0].value
                }`;

          const ticketDetails = await ShowTicketService(ticket.id, companyId);
          const contact: Contact = ticketDetails.contact;

          // Obtendo o tipo do arquivo
          const fileExtension = path.extname(mediaPath);

          //Obtendo o nome do arquivo sem a extensão
          const fileName = path.basename(mediaPath, fileExtension);

          //Obtendo o tipo do arquivo
          const mimeType = mime.lookup(mediaPath);

          let fileNameWithoutExtension = path.basename(
            mediaPath,
            fileExtension
          );

          let fileNameWithExtension = fileNameWithoutExtension;

          if (fileExtension.includes(".png")) {
            fileNameWithExtension = `${fileNameWithoutExtension}${fileExtension}`;
          }

          const media = {
            fieldname: fileNameWithExtension, // Nome do campo no formulário
            originalname: fileNameWithExtension, // Nome original do arquivo
            mimetype: mimeType, // MIME type
            size: getFileSize(mediaPath), // Tamanho em bytes
            filename: fileNameWithExtension, // Nome do arquivo salvo
            path: mediaPath
          } as Express.Multer.File;

          const sentMedia = await sendWabaMessageMediaService({
            media,
            ticket: ticketDetails,
            isPrivate: false,
            isForwarded: false
          });

          await verifyMessageMedia(sentMedia, ticketDetails, contact, true);

          await intervalWhats("5");
        }

        if (elementNowSelected.includes("audio")) {
          const mediaDirectory =
            process.env.BACKEND_URL === "http://localhost:8090"
              ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
                  nodeSelected.data.elements.filter(
                    item => item.number === elementNowSelected
                  )[0].value
                }`
              : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
                  nodeSelected.data.elements.filter(
                    item => item.number === elementNowSelected
                  )[0].value
                }`;

          // Obtendo o tipo do arquivo
          const fileExtension = path.extname(mediaDirectory);

          //Obtendo o nome do arquivo sem a extensão
          const fileNameWithoutExtension = path.basename(
            mediaDirectory,
            fileExtension
          );

          //Obtendo o tipo do arquivo
          const mimeType = mime.lookup(mediaDirectory);

          const fileNotExists = path.resolve(
            __dirname,
            "..",
            "..",
            "..",
            "..",
            "public",
            fileNameWithoutExtension + ".mp4"
          );

          if (fileNotExists) {
            const folder = path.resolve(
              __dirname,
              "..",
              "..",
              "..",
              "..",
              "public",
              fileNameWithoutExtension + fileExtension
            );
            await convertAudio(folder);
          }

          const domain = `${process.env.BACKEND_URL}/public/${fileNameWithoutExtension}.mp4`;

          const ticketDetails = await ShowTicketService(ticket.id, companyId);
          const contact: Contact = ticketDetails.contact;

          const media = {
            fieldname: fileNameWithoutExtension, // Nome do campo no formulário
            originalname: fileNameWithoutExtension, // Nome original do arquivo
            mimetype: mimeType, // MIME type
            size: getFileSize(mediaDirectory), // Tamanho em bytes
            filename: fileNameWithoutExtension, // Nome do arquivo salvo
            path: mediaDirectory
          } as Express.Multer.File;

          const sentMedia = await sendWabaMessageMediaService({
            media,
            ticket: ticketDetails,
            isPrivate: false,
            isForwarded: false
          });

          await verifyMessageMedia(sentMedia, ticketDetails, contact, true);
        }

        if (elementNowSelected.includes("video")) {
          const mediaDirectory =
            process.env.BACKEND_URL === "http://localhost:8090"
              ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
                  nodeSelected.data.elements.filter(
                    item => item.number === elementNowSelected
                  )[0].value
                }`
              : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
                  nodeSelected.data.elements.filter(
                    item => item.number === elementNowSelected
                  )[0].value
                }`;

          // Obtendo o tipo do arquivo
          const fileExtension = path.extname(mediaDirectory);

          //Obtendo o nome do arquivo sem a extensão
          const fileNameWithoutExtension = path.basename(
            mediaDirectory,
            fileExtension
          );

          //Obtendo o tipo do arquivo
          const mimeType = mime.lookup(mediaDirectory);

          const domain = `${process.env.BACKEND_URL}/public/${fileNameWithoutExtension}${fileExtension}`;

          const ticketDetails = await ShowTicketService(ticket.id, companyId);
          const contact: Contact = ticketDetails.contact;

          const media = {
            fieldname: `${fileNameWithoutExtension}${fileExtension}`, // Nome do campo no formulário
            originalname: `${fileNameWithoutExtension}${fileExtension}`, // Nome original do arquivo
            mimetype: mimeType, // MIME type
            size: getFileSize(mediaDirectory), // Tamanho em bytes
            filename: `${fileNameWithoutExtension}${fileExtension}`, // Nome do arquivo salvo
            path: mediaDirectory
          } as Express.Multer.File;

          const sentMedia = await sendWabaMessageMediaService({
            media,
            ticket: ticketDetails,
            isPrivate: false,
            isForwarded: false
          });

          await verifyMessageMedia(sentMedia, ticketDetails, contact, true);
        }
      }
    }

    if (nodeSelected.type === "img") {
      const mediaPath =
        process.env.BACKEND_URL === "http://localhost:8090"
          ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
              nodeSelected.data.url
            }`
          : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
              nodeSelected.data.url
            }`;

      // Obtendo o tipo do arquivo
      const fileExtension = path.extname(mediaPath);

      //Obtendo o nome do arquivo sem a extensão
      const fileNameWithoutExtension = path.basename(mediaPath, fileExtension);

      //Obtendo o tipo do arquivo
      const mimeType = mime.lookup(mediaPath);

      const domain = `${process.env.BACKEND_URL}/public/${fileNameWithoutExtension}${fileExtension}`;

      const ticketDetails = await ShowTicketService(ticket.id, companyId);
      const contact: Contact = ticketDetails.contact;

      const media = {
        fieldname: fileNameWithoutExtension, // Nome do campo no formulário
        originalname: fileNameWithoutExtension, // Nome original do arquivo
        mimetype: mimeType, // MIME type
        size: getFileSize(mediaPath), // Tamanho em bytes
        filename: fileNameWithoutExtension, // Nome do arquivo salvo
        path: mediaPath
      } as Express.Multer.File;

      const sentMedia = await sendWabaMessageMediaService({
        media,
        ticket: ticketDetails,
        isPrivate: false,
        isForwarded: false
      });

      await verifyMessageMedia(sentMedia, ticketDetails, contact, true);
    }

    if (nodeSelected.type === "audio") {
      const mediaDirectory =
        process.env.BACKEND_URL === "http://localhost:8090"
          ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
              nodeSelected.data.url
            }`
          : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
              nodeSelected.data.url
            }`;

      // Obtendo o tipo do arquivo
      const fileExtension = path.extname(mediaDirectory);

      //Obtendo o nome do arquivo sem a extensão
      const fileNameWithoutExtension = path.basename(
        mediaDirectory,
        fileExtension
      );

      //Obtendo o tipo do arquivo
      const mimeType = mime.lookup(mediaDirectory);

      const domain = `${process.env.BACKEND_URL}/public/${fileNameWithoutExtension}${fileExtension}`;

      const ticketDetails = await ShowTicketService(ticket.id, companyId);
      const contact: Contact = ticketDetails.contact;

      const media = {
        fieldname: fileNameWithoutExtension, // Nome do campo no formulário
        originalname: fileNameWithoutExtension, // Nome original do arquivo
        mimetype: mimeType, // MIME type
        size: getFileSize(mediaDirectory), // Tamanho em bytes
        filename: fileNameWithoutExtension, // Nome do arquivo salvo
        path: mediaDirectory
      } as Express.Multer.File;

      const sentMedia = await sendWabaMessageMediaService({
        media,
        ticket: ticketDetails,
        isPrivate: false,
        isForwarded: false
      });

      await verifyMessageMedia(sentMedia, ticketDetails, contact, true);

      await intervalWhats("1");
    }
    if (nodeSelected.type === "interval") {
      await intervalWhats(nodeSelected.data.sec);
    }
    if (nodeSelected.type === "video") {
      const mediaDirectory =
        process.env.BACKEND_URL === "http://localhost:8090"
          ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
              nodeSelected.data.url
            }`
          : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
              nodeSelected.data.url
            }`;

      // Obtendo o tipo do arquivo
      const fileExtension = path.extname(mediaDirectory);

      //Obtendo o nome do arquivo sem a extensão
      const fileNameWithoutExtension = path.basename(
        mediaDirectory,
        fileExtension
      );

      //Obtendo o tipo do arquivo
      const mimeType = mime.lookup(mediaDirectory);

      const domain = `${process.env.BACKEND_URL}/public/${fileNameWithoutExtension}${fileExtension}`;

      const ticketDetails = await ShowTicketService(ticket.id, companyId);
      const contact: Contact = ticketDetails.contact;

      const media = {
        fieldname: fileNameWithoutExtension, // Nome do campo no formulário
        originalname: fileNameWithoutExtension, // Nome original do arquivo
        mimetype: mimeType, // MIME type
        size: getFileSize(mediaDirectory), // Tamanho em bytes
        filename: fileNameWithoutExtension, // Nome do arquivo salvo
        path: mediaDirectory
      } as Express.Multer.File;

      const sentMedia = await sendWabaMessageMediaService({
        media,
        ticket: ticketDetails,
        isPrivate: false,
        isForwarded: false
      });

      await verifyMessageMedia(sentMedia, ticketDetails, contact, true);
    }
    let isRandomizer: boolean;
    if (nodeSelected.type === "randomizer") {
      const selectedRandom = randomizarCaminho(nodeSelected.data.percent / 100);

      const resultConnect = connects.filter(
        connect => connect.source === nodeSelected.id
      );
      if (selectedRandom === "A") {
        next = resultConnect.filter(item => item.sourceHandle === "a")[0]
          .target;
        noAlterNext = true;
      } else {
        next = resultConnect.filter(item => item.sourceHandle === "b")[0]
          .target;
        noAlterNext = true;
      }
      isRandomizer = true;
    }
    let isMenu: boolean;

    if (nodeSelected.type === "menu") {
      if (pressKey) {
        const filterOne = connectStatic.filter(
          confil => confil.source === next
        );
        const filterTwo = filterOne.filter(
          filt2 => filt2.sourceHandle === "a" + pressKey
        );
        if (filterTwo.length > 0) {
          execFn = filterTwo[0].target;
        } else {
          execFn = undefined;
        }
        // execFn =
        //   connectStatic
        //     .filter(confil => confil.source === next)
        //     .filter(filt2 => filt2.sourceHandle === "a" + pressKey)[0]?.target ??
        //   undefined;
        if (execFn === undefined) {
          break;
        }
        pressKey = "999";

        const isNodeExist = nodes.filter(item => item.id === execFn);
        console.log(828, isNodeExist);
      } else {
        console.log(681, "menu");
        let optionsMenu = "";
        nodeSelected.data.arrayOption.map(item => {
          optionsMenu += `[${item.number}] ${item.value}\n`;
        });

        const menuCreate = `${nodeSelected.data.message}\n\n${optionsMenu}`;

        const ticketDetails = await ShowTicketService(ticket.id, companyId);

        await sendWabaMessageService({
          body: menuCreate,
          vCard: null,
          ticket: ticketDetails,
          quotedMsg: null
        });

        //await CreateMessageService({ messageData: messageData, companyId });

        //await SendWhatsAppMessage({ body: bodyFor, ticket: ticketDetails, quotedMsg: null })

        // await SendMessage(whatsapp, {
        //   number: numberClient,
        //   body: msg.body
        // });

        SetTicketMessagesAsRead(ticketDetails);

        await intervalWhats("1");

        if (ticket) {
          ticket = await Ticket.findOne({
            where: {
              id: ticket.id,
              whatsappId: getSession.id,
              companyId: companyId
            }
          });
        } else {
          ticket = await Ticket.findOne({
            where: {
              id: idTicket,
              whatsappId: getSession.id,
              companyId: companyId
            }
          });
        }

        console.log(883, "MENUCREATE", ticket);

        if (ticket) {
          await ticket.update({
            queueId: ticket.queueId ? ticket.queueId : null,
            userId: null,
            companyId: companyId,
            flowWebhook: true,
            lastFlowId: nodeSelected.id,
            dataWebhook: null,
            hashFlowId: hashWebhookId,
            flowStopped: idFlowDb.toString()
          });
        }

        break;
      }
    }

    let isContinue = false;

    if (pressKey === "999" && execCount > 0) {
      pressKey = undefined;
      let result = connects.filter(connect => connect.source === execFn)[0];
      if (typeof result === "undefined") {
        next = "";
      } else {
        if (!noAlterNext) {
          await ticket.reload();

          next = result.target;
        }
      }
    } else {
      let result;
      if (isMenu) {
        result = { target: execFn };
        isContinue = true;
        pressKey = undefined;
      } else if (isQuestion) {
        console.log(804);
        result = { target: execFn };
        isContinue = true;
        pressKey = undefined;
      } else if (isRandomizer) {
        isRandomizer = false;
        result = next;
      } else {
        result = connects.filter(connect => connect.source === next)[0];
      }

      if (typeof result === "undefined") {
        console.log(517, "ActionsWebhookFacebookService");
        next = "";
      } else {
        if (!noAlterNext) {
          console.log(520, "ActionsWebhookFacebookService");
          next = result.target;
        }
      }
    }

    if (!pressKey && !isContinue) {
      const nextNode = connects.filter(
        connect => connect.source === nodeSelected.id
      ).length;
      console.log(530, "ActionsWebhookFacebookService");
      if (nextNode === 0) {
        console.log(532, "ActionsWebhookFacebookService");

        ticket = await Ticket.findOne({
          where: {
            id: idTicket
          },
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "name", "profile"]
            }
          ]
        });

        await ticket.update({
          lastFlowId: null,
          dataWebhook: null,
          hashFlowId: null,
          flowWebhook: false,
          flowStopped: idFlowDb.toString()
        });

        break;
      }
    }

    isContinue = false;

    if (next === "") {
      break;
    }

    ticket = await Ticket.findOne({
      where: { id: idTicket, companyId: companyId }
    });

    await ticket.update({
      queueId: ticket?.queueId,
      userId: null,
      companyId: companyId,
      flowWebhook: true,
      lastFlowId: nodeSelected.id,
      hashFlowId: hashWebhookId,
      flowStopped: idFlowDb.toString()
    });

    noAlterNext = false;
    execCount++;
  }

  return "ds";
};

const constructJsonLine = (line: string, json: any) => {
  let valor = json;
  const chaves = line.split(".");

  if (chaves.length === 1) {
    return valor[chaves[0]];
  }

  for (const chave of chaves) {
    valor = valor[chave];
  }
  return valor;
};

function removerNaoLetrasNumeros(texto: string) {
  // Substitui todos os caracteres que não são letras ou números por vazio
  return texto.replace(/[^a-zA-Z0-9]/g, "");
}

const intervalWhats = (time: string) => {
  const seconds = parseInt(time) * 1000;
  return new Promise(resolve => setTimeout(resolve, seconds));
};

const replaceMessages = (variables, message) => {
  return message.replace(
    /{{\s*([^{}\s]+)\s*}}/g,
    (match, key) => variables[key] || ""
  );
};

async function updateQueueId(
  ticket: Ticket,
  companyId: number,
  queueId: number
) {
  await ticket.update({
    status: "pending",
    queueId: queueId,
    userId: ticket.userId,
    companyId: companyId
  });

  await FindOrCreateATicketTrakingService({
    ticketId: ticket.id,
    companyId,
    whatsappId: ticket.whatsappId,
    userId: ticket.userId
  });

  await UpdateTicketService({
    ticketData: {
      status: "pending",
      queueId: queueId
    },
    ticketId: ticket.id,
    companyId
  });

  await CreateLogTicketService({
    ticketId: ticket.id,
    type: "queue",
    queueId: queueId
  });
}

function convertAudio(inputFile: string): Promise<string> {
  let outputFile: string;

  if (inputFile.endsWith(".mp3")) {
    outputFile = inputFile.replace(".mp3", ".mp4");
  }

  console.log("output", outputFile);

  return new Promise((resolve, reject) => {
    ffmpeg(inputFile)
      .toFormat("mp4")
      .save(outputFile)
      .on("end", () => {
        resolve(outputFile);
      })
      .on("error", err => {
        console.error("Error during conversion:", err);
        reject(err);
      });
  });
}
