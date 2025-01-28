import FormData from "form-data";
import fs from "node:fs";
import { exec } from "child_process";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import path from "node:path";
import * as Sentry from "@sentry/node";
import mime from "mime-types";
import sharp from "sharp";

import ffmpeg from "fluent-ffmpeg";
import Ticket from "../../../models/Ticket";
import { sendAttachmentFromUrl, sendWabaMedia } from "../graphAPI";
import logger from "../../../utils/logger";
import AppError from "../../../errors/AppError";



type attachments =  {
  type: string,
  payload: {
    url: string
  }
}


interface Imsg {
  mid: string;
  fromMe: boolean;
  is_echo: boolean;
  text: string;
  reply_to: {
    mid: string | null
  };
  attachments: attachments[];
  media: Express.Multer.File
}

interface Request {
  ticket: Ticket;
  media?: Express.Multer.File;
  body?: string;
  url?: string;
  isPrivate?: boolean;
  isForwarded?: boolean;
}

export const typeAttachment = (media: Express.Multer.File) => {
  if (media.mimetype.includes("image")) {
    return "image";
  }
  if (media.mimetype.includes("video")) {
    return "video";
  }
  if (media.mimetype.includes("audio")) {
    return "audio";
  }
  if (media.mimetype.includes("application")){
    return "application"
  }

  if (media.mimetype.includes("document")){
    return "document"
  }

  if(media.mimetype.includes("gif")){
    return "gif"
  }

  return "";
};


const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

const processAudio = async (audio: string, companyId: string): Promise<string> => {
  const outputAudio = `${publicFolder}/company${companyId}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i ${audio}  -vn -ar 44100 -ac 2 -b:a 192k ${outputAudio} -y`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        // fs.unlinkSync(audio);
        resolve(outputAudio);
      }
    );
  });
}


const convertGifToMp4 = (
  ticket,
  media
) => {
  
  const inputFile = path.join(publicFolder, `company${ticket.companyId}`, media.filename)
  const output = inputFile.replace(".gif", ".mp4")

   return new Promise<string>((resolve, reject) => {
    ffmpeg(inputFile)
      .toFormat("mp4")
      .videoCodec("libx264") // Codec de vídeo suportado pelo WhatsApp
      .outputOptions("-pix_fmt yuv420p") // Formato de pixel compatível
      .on("end", () => {
        if(fs.existsSync(inputFile)){
          fs.unlinkSync(inputFile)
        }
        resolve(output);
      })
      .on("error", (err: any) => {
        console.error("Erro durante a conversão:", err);
        reject(err);
      })
      .save(output);
  });

}

async function convertWebpToImage(ticket: Ticket, media: Express.Multer.File ): Promise<string> {
  
  const inputFile = path.join(publicFolder, `company${ticket.companyId}`, media.filename)
  const output = inputFile.replace(".webp", ".jpeg")

  try {
     await sharp(inputFile)
      .toFormat("jpeg")
      .toFile(output);
  } catch (error) {
    console.error("Erro na conversão:", error);
  }

  return output
}


export const sendWabaMessageMediaService = async ({
  media,
  ticket,
  body,
  isPrivate = false,
  isForwarded = false,
}: Request): Promise<any> => {
  try {

    let msg: Imsg;

    

    if(typeAttachment(media) === "image"){

      if(media.mimetype === "image/gif"){
        
        const videoPath = await convertGifToMp4(ticket, media)
        const file = fs.createReadStream(videoPath);
        
        // 1. Obter o nome do arquivo
        const fileName = path.basename(videoPath);

        // 2. Obter o MIME type
        const mimeType = mime.lookup(videoPath) || "application/octet-stream";

        // 3. Obter o tamanho do arquivo
        let fileSize: number | null = null;
        if (fs.existsSync(videoPath)) {
          const stats = fs.statSync(videoPath); // Obtém estatísticas do arquivo
          fileSize = stats.size; // Tamanho em bytes
        } else {
          console.error("Arquivo não encontrado:", videoPath);
        }

        const options = {
          fieldname: fileName, // Nome do campo no formulário
          originalname: fileName, // Nome original do arquivo
          mimetype: "video/mp4", // MIME type
          size: fileSize, // Tamanho em bytes
          filename: fileName, // Nome do arquivo salvo
          path: videoPath
        } as Express.Multer.File

        const data = new FormData();
        data.append("messaging_product", "whatsapp");
        data.append("file", file, {
          contentType: "video/mp4"
          });
        data.append("type", "video/mp4");
          
        const sendMessage = await sendWabaMedia(
          ticket.contact.number,
          ticket.whatsapp.officialAccessToken,
          ticket.whatsapp.officialPhoneNumberId,
          data,
          "video",
          body,
          media.originalname
        );

        await ticket.update({ lastMessage:  fileName });
    
        const domain = `${process.env.BACKEND_URL}/public/company${ticket.companyId}/${fileName}`;

        
        msg = {
          mid: sendMessage.messages[0].id,
          fromMe: true,
          is_echo: false,
          text: body,
          reply_to: {
            mid: null,
          },
          attachments: [
            {
              type: "video",
              payload: {
                url: domain
              }
            }
          ],
          media: options
        }
    

      }else if(media.mimetype === "image/webp"){
        const imagePath = await convertWebpToImage(ticket, media)
        const file = fs.createReadStream(imagePath);
        
        // 1. Obter o nome do arquivo
        const fileName = path.basename(imagePath);

        // 2. Obter o MIME type
        const mimeType = mime.lookup(imagePath) || "application/octet-stream";

        // 3. Obter o tamanho do arquivo
        let fileSize: number | null = null;
        if (fs.existsSync(imagePath)) {
          const stats = fs.statSync(imagePath); // Obtém estatísticas do arquivo
          fileSize = stats.size; // Tamanho em bytes
        } else {
          console.error("Arquivo não encontrado:", imagePath);
        }

        const options = {
          fieldname: fileName, // Nome do campo no formulário
          originalname: media.originalname, // Nome original do arquivo
          mimetype: "image/jpeg", // MIME type
          size: fileSize, // Tamanho em bytes
          filename: fileName, // Nome do arquivo salvo
          path: imagePath
        } as Express.Multer.File

        const data = new FormData();
        data.append("messaging_product", "whatsapp");
        data.append("file", file, {
          contentType: "image/jpeg"
          });
        data.append("type", "image/jpeg");
          
        const sendMessage = await sendWabaMedia(
          ticket.contact.number,
          ticket.whatsapp.officialAccessToken,
          ticket.whatsapp.officialPhoneNumberId,
          data,
          "image",
          body,
          media.originalname
        );

        await ticket.update({ lastMessage: media.originalname });
    
        const domain = `${process.env.BACKEND_URL}/public/company${ticket.companyId}/${fileName}`;

        
        msg = {
          mid: sendMessage.messages[0].id,
          fromMe: true,
          is_echo: false,
          text: body,
          reply_to: {
            mid: null,
          },
          attachments: [
            {
              type: "image",
              payload: {
                url: domain
              }
            }
          ],
          media: options
        }

      }else {

        const file = fs.createReadStream(media.path);
      
        const data = new FormData();
        data.append("messaging_product", "whatsapp");
        data.append("file", file, {
          contentType: media.mimetype
          });
        data.append("type", media.mimetype);
          
        const sendMessage = await sendWabaMedia(
          ticket.contact.number,
          ticket.whatsapp.officialAccessToken,
          ticket.whatsapp.officialPhoneNumberId,
          data,
          typeAttachment(media),
          body
        );
    
        await ticket.update({ lastMessage: media.originalname });

        const domain =  `${process.env.BACKEND_URL}/public/company${ticket.companyId}/${media.filename}`

        msg = {
          mid: sendMessage.messages[0].id,
          fromMe: true,
          is_echo: false,
          text: body,
          reply_to: {
            mid: null,
          },
          attachments: [
            {
              type: "image",
              payload: {
                url: domain
              }
            }
          ],
          media: media
        }

      }
    }

    if (typeAttachment(media) === "audio") {
      const convert = await processAudio(media.path, String(ticket.companyId));

      const file = fs.createReadStream(convert);

      const data = new FormData();
      data.append("messaging_product", "whatsapp");
      data.append("file", file, {
        contentType: "audio/mpeg"
      });
      data.append("type", "audio/mpeg");
  
      const sendMessage = await sendWabaMedia(
        ticket.contact.number,
        ticket.whatsapp.officialAccessToken,
        ticket.whatsapp.officialPhoneNumberId,
        data,
        typeAttachment(media),
        body,
        media.originalname
      );
  
      await ticket.update({ lastMessage:     media.originalname });
  
      const domain = `${process.env.BACKEND_URL}/public/company${ticket.companyId}/${media.filename}`;

      msg = {
        mid: sendMessage.messages[0].id,
        fromMe: true,
        is_echo: false,
        text: body,
        reply_to: {
          mid: null,
        },
        attachments: [
          {
            type: "audio",
            payload: {
              url: domain
            }
          }
        ],
        media: media
      }
  
    }
  
    
    if(typeAttachment(media) === "video"){

      const file = fs.createReadStream(media.path);
      
      const data = new FormData();
      data.append("messaging_product", "whatsapp");
      data.append("file", file, {
        contentType: media.mimetype
        });
      data.append("type", "video");
        
      const sendMessage = await sendWabaMedia(
        ticket.contact.number,
        ticket.whatsapp.officialAccessToken,
        ticket.whatsapp.officialPhoneNumberId,
        data,
        typeAttachment(media),
        body,
        media.originalname
      );
  
      await ticket.update({ lastMessage: media.originalname });
  
      const domain = `${process.env.BACKEND_URL}/public/company${ticket.companyId}/${media.filename}`

      msg = {
        mid: sendMessage.messages[0].id,
        fromMe: true,
        is_echo: false,
        text: body,
        reply_to: {
          mid: null,
        },
        attachments: [
          {
            type: "video",
            payload: {
              url: domain
            }
          }
        ],
        media: media
      }
  
    }

    if(typeAttachment(media) === "document"){
      const file = fs.createReadStream(media.path);

      const data = new FormData();
      data.append("messaging_product", "whatsapp");
      data.append("file", file, {
        contentType: media.mimetype
      });
      data.append("type", media.mimetype);

      console.log(440, "MessageController", typeAttachment(media))

      const sendMessage = await sendWabaMedia(
        ticket.contact.number,
        ticket.whatsapp.officialAccessToken,
        ticket.whatsapp.officialPhoneNumberId,
        data,
        typeAttachment(media),
        body,
        media.originalname
      );
  
      await ticket.update({ lastMessage: media.originalname });
  
      const domain = `${process.env.BACKEND_URL}/public/company${ticket.companyId}/${media.filename}`;

      msg = {
        mid: sendMessage.messages[0].id,
        fromMe: true,
        is_echo: false,
        text: body,
        reply_to: {
          mid: null,
        },
        attachments: [
          {
            type: "document",
            payload: {
              url: domain
            }
          }
        ],
        media: media
      }

    }

    if(typeAttachment(media) === "application"){


      const file = fs.createReadStream(media.path);

      const data = new FormData();
      data.append("messaging_product", "whatsapp");
      data.append("file", file, {
        contentType: media.mimetype});
      data.append("type", media.mimetype);

      const sendMessage = await sendWabaMedia(
        ticket.contact.number,
        ticket.whatsapp.officialAccessToken,
        ticket.whatsapp.officialPhoneNumberId,
        data,
        "document",
        body,
        media.originalname
      );


      await ticket.update({ lastMessage: media.originalname });
  
      const domain = `${process.env.BACKEND_URL}/public/company${ticket.companyId}/${media.filename}`;

      msg = {
        mid: sendMessage.messages[0].id,
        fromMe: true,
        is_echo: false,
        text: body,
        reply_to: {
          mid: null,
        },
        attachments: [
          {
            type: "application",
            payload: {
              url: domain
            }
          }
        ],
        media: media
      }
      
      console.log(523, msg, typeAttachment(media))
    }
    

    return msg
   

  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
    console.log(err);
  }
};
