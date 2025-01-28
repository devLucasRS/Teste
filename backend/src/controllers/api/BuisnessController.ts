import { Request, Response } from "express";
import Whatsapp from "../../models/Whatsapp";
import { handleWabaMessage } from "../../services/FacebookServices/facebookMessageListener";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const whatsApp = await Whatsapp.findOne({
    where: {
      token: id
    }
  });

  if (!whatsApp) {
    return res.status(404).json({
      message: "Received"
    });
  }

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === whatsApp.officialVerifyToken) {
      return res.status(200).send(challenge);
    }
  }
};

export const webhook = async (req: Request, res: Response) => {
  const { body } = req;


  if (body.object === "whatsapp_business_account") {
    let channel: string = "oficial";


    body.entry?.forEach(async (entry: any) => {
      if(entry?.statuses) return;

      const getTokenPage = await Whatsapp.findOne({
        where: {
          officialWppBusinessId: entry.id,
          channel
        }
      });

      if (getTokenPage && entry.changes[0].value?.messages) {
        handleWabaMessage(getTokenPage, entry, channel, getTokenPage.companyId);
      }
    });

    return res.status(200).json({
      message: "EVENT_RECEIVED"
    });
  }

  return res.status(404).json({
    message: body
  });
};
