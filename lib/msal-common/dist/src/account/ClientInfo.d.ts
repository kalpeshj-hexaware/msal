import { ICrypto } from "../crypto/ICrypto";
/**
 * Client info object which consists of two IDs. Need to add more info here.
 */
export declare type ClientInfo = {
    uid: string;
    utid: string;
};
/**
 * Function to build a client info object
 * @param rawClientInfo
 * @param crypto
 */
export declare function buildClientInfo(rawClientInfo: string, crypto: ICrypto): ClientInfo;