import axios from "axios";
import FormData from "form-data";
import { createReadStream } from "fs";
import logger from "../../utils/logger";
import Contact from "../../models/Contact";

const formData: FormData = new FormData();

const apiBase = (token: string) =>
  axios.create({
    baseURL: "https://graph.facebook.com/v18.0/",
    params: {
      access_token: token
    }
  });

  
export const sendWabaMesage = async (
  id: string | number,
  text: string,
  officialAccessToken: string,
  officialWppBusinessId: string,
  vCard: Contact
) => {

  try {
  
 

    let payload: any = ""

    if(vCard){

      const numberContact = vCard.number
      const firstName = vCard.name.split(' ')[0]
      const lastName = String(vCard.name).replace(vCard.name.split(' ')[0], '')

      payload = {
        "messaging_product": "whatsapp",
        "to": id,
        "type": "contacts",
        "contacts": [
            {
              "name": {
                  "formatted_name": vCard.name,
                  "first_name": firstName,
                  "last_name": lastName,
              },
              "phones": [
                  {
                      "phone": numberContact,
                      "type": "HOME"
                  },
              ],
          }
        ]
    }
    }else {
     payload =  JSON.stringify({
        messaging_product: "whatsapp",
        to: id,
        type: "text",
        text: {
          body: text
        }
      }) 
    }


    if(payload){  
      const { data } = await axios({
        url: `https://graph.facebook.com/v20.0/${officialWppBusinessId}/messages`,
        method: "post",
        headers: {
          Authorization: `Bearer ${officialAccessToken}`,
          "Content-Type": "application/json"
        },
        data: payload
      });
      return data;
    }

    throw new Error("Mensagem com campo vazio.")

    
  } catch (err) {
    console.log(err)
  }
};

const sendMediaFromId = async (
  to: string,
  officialAccessToken: string,
  officialWppBusinessId: string,
  id: string,
  type: string,
  caption: string,
  originalname?: string
): Promise<{
  messaging_product: string;
  contacts: [
    {
      input: string;
      wa_id: string;
    }
  ];
  messages: [
    {
      id: string;
      message_status: string;
    }
  ];
}> => {
  
  let payload = "";
  
  if(type.includes("image")){
    payload = JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type,
      image: {
        caption,
        id
      }
    })
  }

  if(type.includes("video")){
    payload = JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type,
      video: {
        caption,
        id
      }
    })
  }

  if(type.includes("audio")){
    payload = JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type,
      audio: {
        caption,
        id
      }
    })
  }

  if(type.includes("document")){
    payload = JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type,
      document: {
        caption,
        id,
        filename: originalname
      }
    })
  }
  

  const { data } = await axios({
    url: `https://graph.facebook.com/v20.0/${officialWppBusinessId}/messages`,
    method: "post",
    headers: {
      Authorization: `Bearer ${officialAccessToken}`,
      "Content-Type": "application/json"
    },
    data: payload
  });

  return data;
};

export const getWabaMediaUrl = async (
  officialAccessToken: string,
  id: string
): Promise<{
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
  messaging_product: string
}> => {

  const { data } = await axios({
    url: `https://graph.facebook.com/v20.0/${id}`,
    method: "get",
    headers: {
      Authorization: `Bearer ${officialAccessToken}`
    },
  });

  return data;
} 


export const sendWabaMedia = async (
  to: string,
  officialAccessToken: string,
  officialWppBusinessId: string,
  data: FormData,
  type: string,
  caption: string,
  originalname?: string
): Promise<{
  messaging_product: string;
  contacts: [
    {
      input: string;
      wa_id: string;
    }
  ];
  messages: [
    {
      id: string;
      message_status: string;
    }
  ];
}> => {

 
    const { data: response } = await axios({
      url: `https://graph.facebook.com/v20.0/${officialWppBusinessId}/media`,
      method: "post",
      headers: {
        Authorization: `Bearer ${officialAccessToken}`
      },
      data: data
    });
   

  const { id } = response;

  const payload = await sendMediaFromId(
    to,
    officialAccessToken,
    officialWppBusinessId,
    id,
    type,
    caption,
    originalname
  );

  return payload;
  
};


export const sendWabaAttachmentFromUrl = async (
  id: string,
  officialAccessToken: string,
  officialWppBusinessId: string,
  link: string,
  type: string
): Promise<{
  messaging_product: string;
  contacts: [
    {
      input: string;
      wa_id: string;
    }
  ];
  messages: [
    {
      id: string;
      message_status: string;
    }
  ];
}> => {
  try {
    const { data } = await axios({
      url: `https://graph.facebook.com/v20.0/${officialWppBusinessId}/messages`,
      method: "post",
      headers: {
        Authorization: `Bearer ${officialAccessToken}`,
        "Content-Type": "application/json"
      },
      data: JSON.stringify({
        messaging_product: "whatsapp",
        to: id,
        type: "IMAGE",
        image: {
          link
        }
      })
    });

    return data;
  } catch (err) {
    console.log(err)
  }
};

export const getAccessToken = async (): Promise<string> => {
  const { data } = await axios.get(
    "https://graph.facebook.com/v18.0/oauth/access_token",
    {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        grant_type: "client_credentials"
      }
    }
  );

  return data.access_token;
};

export const markSeen = async (id: string, token: string): Promise<void> => {
  await apiBase(token).post(`${id}/messages`, {
    recipient: {
      id
    },
    sender_action: "mark_seen"
  });
};

export const showTypingIndicator = async (
  id: string,
  token: string,
  action: string
): Promise<void> => {
  try {
    const { data } = await apiBase(token).post("me/messages", {
      recipient: {
        id: id
      },
      sender_action: action
    });

    return data;
  } catch (error) {
    console.log(error);
  }
};

export const sendText = async (
  id: string | number,
  text: string,
  token: string
): Promise<void> => {
  try {
    const { data } = await apiBase(token).post("me/messages", {
      recipient: {
        id
      },
      message: {
        text: `${text}`
      }
    });
    return data;
  } catch (error) {
    console.log(error);
  }
};

export const sendAttachmentFromUrl = async (
  id: string,
  url: string,
  type: string,
  token: string
): Promise<void> => {
  try {
    const { data } = await apiBase(token).post("me/messages", {
      recipient: {
        id
      },
      message: {
        attachment: {
          type,
          payload: {
            url
          }
        }
      }
    });

    return data;
  } catch (error) {
    console.log(error);
  }
};

export const sendAttachment = async (
  id: string,
  file: Express.Multer.File,
  type: string,
  token: string
): Promise<void> => {
  formData.append(
    "recipient",
    JSON.stringify({
      id
    })
  );

  formData.append(
    "message",
    JSON.stringify({
      attachment: {
        type,
        payload: {
          is_reusable: true
        }
      }
    })
  );

  const fileReaderStream = createReadStream(file.path);

  formData.append("filedata", fileReaderStream);

  try {
    await apiBase(token).post("me/messages", formData, {
      headers: {
        ...formData.getHeaders()
      }
    });
  } catch (error) {
    throw new Error(error);
  }
};

export const genText = (text: string): any => {
  const response = {
    text
  };

  return response;
};

export const getProfile = async (id: string, token: string): Promise<any> => {
  try {
    const { data } = await apiBase(token).get(id);

    return data;
  } catch (error) {
    console.log(error);
    throw new Error("ERR_FETCHING_FB_USER_PROFILE_2");
  }
};

export const getPageProfile = async (
  id: string,
  token: string
): Promise<any> => {
  try {
    const { data } = await apiBase(token).get(
      `${id}/accounts?fields=name,access_token,instagram_business_account{id,username,profile_picture_url,name}`
    );
    return data;
  } catch (error) {
    console.log(error);
    throw new Error("ERR_FETCHING_FB_PAGES");
  }
};

export const profilePsid = async (id: string, token: string): Promise<any> => {
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v18.0/${id}?access_token=${token}`
    );
    return data;
  } catch (error) {
    console.log(error);
    await getProfile(id, token);
  }
};

export const subscribeApp = async (id: string, token: string): Promise<any> => {
  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v18.0/${id}/subscribed_apps?access_token=${token}`,
      {
        subscribed_fields: [
          "messages",
          "messaging_postbacks",
          "message_deliveries",
          "message_reads",
          "message_echoes"
        ]
      }
    );
    return data;
  } catch (error) {
    console.log(error);
    throw new Error("ERR_SUBSCRIBING_PAGE_TO_MESSAGE_WEBHOOKS");
  }
};

export const unsubscribeApp = async (
  id: string,
  token: string
): Promise<any> => {
  try {
    const { data } = await axios.delete(
      `https://graph.facebook.com/v18.0/${id}/subscribed_apps?access_token=${token}`
    );
    return data;
  } catch (error) {
    throw new Error("ERR_UNSUBSCRIBING_PAGE_TO_MESSAGE_WEBHOOKS");
  }
};

export const getSubscribedApps = async (
  id: string,
  token: string
): Promise<any> => {
  try {
    const { data } = await apiBase(token).get(`${id}/subscribed_apps`);
    return data;
  } catch (error) {
    throw new Error("ERR_GETTING_SUBSCRIBED_APPS");
  }
};

export const getAccessTokenFromPage = async (
  token: string
): Promise<string> => {
  try {
    if (!token) throw new Error("ERR_FETCHING_FB_USER_TOKEN");

    const data = await axios.get(
      "https://graph.facebook.com/v18.0/oauth/access_token",
      {
        params: {
          client_id: process.env.FACEBOOK_APP_ID,
          client_secret: process.env.FACEBOOK_APP_SECRET,
          grant_type: "fb_exchange_token",
          fb_exchange_token: token
        }
      }
    );

    return data.data.access_token;
  } catch (error) {
    console.log(error);
    throw new Error("ERR_FETCHING_FB_USER_TOKEN");
  }
};

export const removeApplcation = async (
  id: string,
  token: string
): Promise<void> => {
  try {
    await axios.delete(`https://graph.facebook.com/v18.0/${id}/permissions`, {
      params: {
        access_token: token
      }
    });
  } catch (error) {
    logger.error("ERR_REMOVING_APP_FROM_PAGE");
  }
};
