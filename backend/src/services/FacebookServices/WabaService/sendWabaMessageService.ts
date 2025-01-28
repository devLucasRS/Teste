import AppError from "../../../errors/AppError";
import Message from "../../../models/Message";
import Ticket from "../../../models/Ticket";
import { sendText, sendWabaMesage } from "../graphAPI";
import formatBody from "../../../helpers/Mustache";
import Contact from "../../../models/Contact";
import FindOrCreateATicketTrakingService from "../../TicketServices/FindOrCreateATicketTrakingService";
import CreateMessageService from "../../MessageServices/CreateMessageService";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
  vCard?: Contact;
}



export const formatContactPreview = (vCard) => {
  const numberContact = vCard.number;
  const firstName = vCard.name.split(' ')[0];
  const lastName = String(vCard.name).replace(vCard.name.split(' ')[0], '')

  const vcard = `BEGIN:VCARD\n`
  + `VERSION:3.0\n`
  + `N:${lastName};${firstName};;;\n`
  + `FN:${vCard.name}\n`
  + `TEL;type=CELL;waid=${numberContact}:+${numberContact}\n`
  + `END:VCARD`;

  return vcard;

}

const sendWabaMessageService = async ({
  body,
  vCard,
  ticket,
  quotedMsg
}: Request): Promise<any> => {
  const { number } = ticket.contact;


  try {

    let vcard = "";
    
    let msg = null;
    const send = await sendWabaMesage(
      number,
      body ? formatBody(body, ticket) : "",
      ticket.whatsapp.officialAccessToken,
      ticket.whatsapp.officialPhoneNumberId,
      vCard
    );
    console.log(56, "sendWabaMessage", vcard)

    if(vCard){
      vcard = formatContactPreview(vCard);
    }

    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId: ticket.companyId,
      whatsappId: ticket.whatsappId,
      userId: ticket.userId
    });

    const messageData =  {
      wid: send.messages[0].id,
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body: vCard ? vcard : body,
      fromMe: true,
      mediaType: vCard ? "contactMessage" : "conversation",
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


    console.log(87, "sendWabaMessage", messageData)

    await ticket.update({ lastMessage: vCard ? vcard : body });

    await CreateMessageService({ messageData, companyId: ticket.companyId });
    
  } catch (err) {
    console.log(err);
    throw new AppError("ERR_SENDING_FACEBOOK_MSG");
  }
};

export default sendWabaMessageService;
