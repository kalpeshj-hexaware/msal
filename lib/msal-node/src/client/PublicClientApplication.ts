/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { ApiId } from "../utils/Constants";
import {
    DeviceCodeClient,
    AuthenticationResult,
    DeviceCodeRequest as CommonDeviceCodeRequest,
    UsernamePasswordRequest as CommonUsernamePasswordRequest,
    UsernamePasswordClient
} from "@azure/msal-common";
import { Configuration } from "../config/Configuration";
import { ClientApplication } from "./ClientApplication";
import { DeviceCodeRequest } from "../request/DeviceCodeRequest";
import { UsernamePasswordRequest } from "../request/UsernamePasswordRequest";

/**
 * This class is to be used to acquire tokens for public client applications (desktop, mobile). Public client applications
 * are not trusted to safely store application secrets, and therefore can only request tokens in the name of an user.
 */
export class PublicClientApplication extends ClientApplication {
    /**
     * Important attributes in the Configuration object for auth are:
     * - clientID: the application ID of your application. You can obtain one by registering your application with our Application registration portal.
     * - authority: the authority URL for your application.
     *
     * AAD authorities are of the form https://login.microsoftonline.com/{Enter_the_Tenant_Info_Here}.
     * - If your application supports Accounts in one organizational directory, replace "Enter_the_Tenant_Info_Here" value with the Tenant Id or Tenant name (for example, contoso.microsoft.com).
     * - If your application supports Accounts in any organizational directory, replace "Enter_the_Tenant_Info_Here" value with organizations.
     * - If your application supports Accounts in any organizational directory and personal Microsoft accounts, replace "Enter_the_Tenant_Info_Here" value with common.
     * - To restrict support to Personal Microsoft accounts only, replace "Enter_the_Tenant_Info_Here" value with consumers.
     *
     * Azure B2C authorities are of the form https://{instance}/{tenant}/{policy}. Each policy is considered
     * its own authority. You will have to set the all of the knownAuthorities at the time of the client application
     * construction.
     *
     * ADFS authorities are of the form https://{instance}/adfs.
     *
     * @param configuration
     */
    constructor(configuration: Configuration) {
        super(configuration);
    }

    /**
     * Acquires a token from the authority using OAuth2.0 device code flow.
     * This flow is designed for devices that do not have access to a browser or have input constraints.
     * The authorization server issues a DeviceCode object with a verification code, an end-user code,
     * and the end-user verification URI. The DeviceCode object is provided through a callback, and the end-user should be
     * instructed to use another device to navigate to the verification URI to input credentials.
     * Since the client cannot receive incoming requests, it polls the authorization server repeatedly
     * until the end-user completes input of credentials.
     *
     * @param request
     */
    public async acquireTokenByDeviceCode(request: DeviceCodeRequest): Promise<AuthenticationResult | null> {
        this.logger.info("acquireTokenByDeviceCode called");
        const validRequest: CommonDeviceCodeRequest = {
            ...request,
            ...this.initializeBaseRequest(request)
        };
        const serverTelemetryManager = this.initializeServerTelemetryManager(ApiId.acquireTokenByDeviceCode, validRequest.correlationId!);
        try {
            const deviceCodeConfig = await this.buildOauthClientConfiguration(
                validRequest.authority,
                serverTelemetryManager
            );
            this.logger.verbose("Auth client config generated");
            const deviceCodeClient = new DeviceCodeClient(deviceCodeConfig);
            return deviceCodeClient.acquireToken(validRequest);
        } catch (e) {
            serverTelemetryManager.cacheFailedRequest(e);
            throw e;
        }
    }

    /**
     * Acquires tokens with password grant by exchanging client applications username and password for credentials
     *
     * The latest OAuth 2.0 Security Best Current Practice disallows the password grant entirely.
     * More details on this recommendation at https://tools.ietf.org/html/draft-ietf-oauth-security-topics-13#section-3.4
     * Microsoft's documentation and recommendations are at:
     * https://docs.microsoft.com/en-us/azure/active-directory/develop/msal-authentication-flows#usernamepassword
     *
     * @param request
     */
    async acquireTokenByUsernamePassword(request: UsernamePasswordRequest): Promise<AuthenticationResult | null> {
        this.logger.info("acquireTokenByUsernamePassword called");
        const validRequest: CommonUsernamePasswordRequest = {
            ...request,
            ...this.initializeBaseRequest(request)
        };
        const serverTelemetryManager = this.initializeServerTelemetryManager(ApiId.acquireTokenByUsernamePassword, validRequest.correlationId!);
        try {
            const usernamePasswordClientConfig = await this.buildOauthClientConfiguration(
                validRequest.authority,
                serverTelemetryManager
            );
            this.logger.verbose("Auth client config generated");
            const usernamePasswordClient = new UsernamePasswordClient(usernamePasswordClientConfig);
            return usernamePasswordClient.acquireToken(validRequest);
        } catch (e) {
            serverTelemetryManager.cacheFailedRequest(e);
            throw e;
        }
    }
}
