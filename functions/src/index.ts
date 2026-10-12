import {setGlobalOptions} from "firebase-functions";
import {onDocumentDeleted} from "firebase-functions/firestore";
import * as logger from "firebase-functions/logger";
import {initializeApp} from "firebase-admin/app";
import {getStorage} from "firebase-admin/storage";

initializeApp();

// Firestore triggers must run in the database's location (see firebase.json).
setGlobalOptions({maxInstances: 10, region: "europe-west6"});

/** Deletes a jump's attachments from Cloud Storage once the jump is deleted. */
export const deleteJumpAttachments = onDocumentDeleted(
  "users/{uid}/jumps/{jumpId}",
  async (event) => {
    const {uid, jumpId} = event.params;
    const prefix = `users/${uid}/jumps/${jumpId}/`;
    await getStorage().bucket().deleteFiles({prefix});
    logger.info("Deleted jump attachments", {prefix});
  },
);
