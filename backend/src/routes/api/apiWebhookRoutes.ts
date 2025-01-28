import express from "express";

import * as BuisnessControllers from "../../controllers/api/BuisnessController";

const apiWebhookRoutes = express.Router();

apiWebhookRoutes.get("/:id", BuisnessControllers.index);
apiWebhookRoutes.post("/:id", BuisnessControllers.webhook)
export default apiWebhookRoutes;