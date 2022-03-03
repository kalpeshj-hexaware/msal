/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { AuthenticationScheme, INetworkModule, Logger } from "@azure/msal-common";
import { jwtVerify, createLocalJWKSet, createRemoteJWKSet, JWTVerifyOptions, JWTPayload } from "jose";
import { buildConfiguration, Configuration, TokenValidationConfiguration } from "../config/Configuration";
import { OpenIdConfigProvider } from "../config/OpenIdConfigProvider";
import { buildTokenValidationParameters, TokenValidationParameters, BaseValidationParameters } from "../config/TokenValidationParameters";
import { TokenValidationResponse } from "../response/TokenValidationResponse";
import { ValidationConfigurationError } from "../error/ValidationConfigurationError";
import { ValidationError } from "../error/ValidationError";
import { name, version } from "../packageMetadata";
import crypto from "crypto";

export class TokenValidator {
    private config: TokenValidationConfiguration;
    protected logger: Logger;
    protected networkInterface: INetworkModule;
    protected openIdConfigProvider: OpenIdConfigProvider;

    constructor(configuration: Configuration) {
        this.config = buildConfiguration(configuration);
        this.logger = new Logger(this.config.system.loggerOptions, name, version);
        this.networkInterface = this.config.system.networkClient,
        this.openIdConfigProvider = new OpenIdConfigProvider(this.config, this.networkInterface, this.logger);
    }

    validateTokenMiddleware(options: TokenValidationParameters) {
        // @ts-ignore
        return (req: any, res: any, next: any) => {

            this.validateTokenFromRequest(req, options)
                .then(() => {
                    next();
                })
                .catch((error) => {
                    next(error);
                });
        };
    }

    // @ts-ignore
    addAuthorizationHeaderMiddleware(resource: string) {
        // @ts-ignore
        return (req: any, res: any, next: any) => {
            console.log("REQUEST: ", req.session.protectedResources);
            const token = req.session.protectedResources[resource].accessToken;
            req.headers.authorization = `Bearer ${token}`;
            next();
        };
    }

    // What would be the request type here?
    async validateTokenFromRequest(request: any, options: TokenValidationParameters): Promise<TokenValidationResponse> {
        this.logger.trace("TokenValidator.validateTokenFromRequest called");

        console.log("TOKEN VALIDATION LIBRARY: ", request.headers);

        // const token = "tokentoken";

        // Determine header type - bearer or other. If other, we will call proxy or MISE. If bearer, continue. 
        if (request.headers && request.headers.authorization) {
            const authComponents = request.headers.authorization.split(" ");
            if (authComponents.length === 2 && authComponents[0].toLowerCase() === AuthenticationScheme.BEARER.toLowerCase()) {
                const token: string = authComponents[1];
                this.logger.verbose("Bearer token extracted from request authorization headers");
                return this.validateToken(token, options);
            } else {
                this.logger.verbose("Request authorization headers does not include bearer token");
                // If not bearer, call CAE/EasyAuth/MISE solution here for more complex handling
            }
        } 
        
        if (request.body && request.body.access_token) {
            const token: string = request.body.access_token;
            if (token) {
                this.logger.verbose("Token extracted from request body");
                return this.validateToken(token, options);
            }
        }

        throw new Error("no tokens in header or body");
    }

    // What would be the response type here?
    async validateTokenFromResponse(response: any, options: TokenValidationParameters): Promise<TokenValidationResponse[]> {
        this.logger.trace("TokenValidator.validateTokenFromResponse called");

        if (response.token_type === AuthenticationScheme.BEARER) {
            const validateResponse:TokenValidationResponse[] = [];

            if (response.id_token) {
                // Add checks for code and access token for c_hash and at_hash check
                const validateIdTokenResponse: TokenValidationResponse = await this.validateToken(response.id_token, options);
                validateResponse.push(validateIdTokenResponse);
            }

            if (response.access_token) {
                const validateAccessTokenResponse: TokenValidationResponse = await this.validateToken(response.access_token, options);
                validateResponse.push(validateAccessTokenResponse);
            }

            return validateResponse;
        } else {
            throw new Error("Only bearer authentication scheme supported at this time");
        }
    }

    async validateToken(token: string, options: TokenValidationParameters): Promise<TokenValidationResponse> {
        this.logger.trace("TokenValidator.validateToken called");
        
        if (!token || token.length < 1) {
            throw ValidationConfigurationError.createMissingTokenError();
        }

        const validationParams: BaseValidationParameters = await buildTokenValidationParameters(options);
        this.logger.verbose("TokenValidator - ValidationParams built");
            
        const jwks = await this.getJWKS(validationParams);

        const jwtVerifyParams: JWTVerifyOptions = {
            algorithms: validationParams.validAlgorithms,
            issuer: this.setIssuerParams(options),
            audience: this.setAudienceParams(options),
            subject: validationParams.subject,
            typ: validationParams.validTypes[0]
        };

        const { payload, protectedHeader } = await jwtVerify(token, jwks, jwtVerifyParams);

        this.validateClaims(payload, validationParams);

        return {
            protectedHeader,
            payload,
            token,
            tokenType: validationParams.validTypes[0]
        } as TokenValidationResponse;
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async getJWKS(validationParams: BaseValidationParameters): Promise<any> {
        this.logger.trace("TokenValidator.getJWKS called");
        
        // Prioritize keystore or jwksUri if provided
        if (validationParams.issuerSigningKeys) {
            this.logger.verbose("TokenValidator - issuerSigningKeys provided");
            return createLocalJWKSet({
                keys: validationParams.issuerSigningKeys
            });
        } 
        
        if (validationParams.issuerSigningJwksUri) {
            this.logger.verbose("TokenValidator - Creating JWKS from JwksUri");
            return createRemoteJWKSet(new URL(validationParams.issuerSigningJwksUri));
        }

        // Do resiliency well-known endpoint thing here
        const retrievedJwksUri: string = await this.openIdConfigProvider.fetchJwksUriFromEndpoint();
        this.logger.verbose("TokenValidator - Creating JWKS from default");
        return createRemoteJWKSet(new URL(retrievedJwksUri));
    }

    setIssuerParams(options: TokenValidationParameters): string[] {
        this.logger.trace("TokenValidator.setIssuerParams called");

        // Check that validIssuers is not empty
        if (options.validIssuers.length < 1 || options.validIssuers[0].length < 1) {
            throw ValidationConfigurationError.createEmptyIssuerError();
        }

        return options.validIssuers;
    }

    setAudienceParams(options: TokenValidationParameters): string[] {
        this.logger.trace("TokenValidator.setAudienceParams called");

        // Check that validAudiences is not empty
        if (options.validAudiences.length < 1 || options.validAudiences[0].length < 1) {
            throw ValidationConfigurationError.createEmptyAudienceError();
        }

        return options.validAudiences;
    }
 
    async validateClaims(payload: JWTPayload, validationParams: BaseValidationParameters): Promise<void> {
        this.logger.trace("TokenValidator.validateClaims called");

        // Validate nonce
        if (payload.nonce) {
            if (!validationParams.nonce) {
                throw ValidationConfigurationError.createMissingNonceError();
            } else if (validationParams.nonce === payload.nonce) {
                this.logger.verbose("Nonce validated");
            } else {
                throw ValidationError.createInvalidNonceError();
            }
        }

        // Validate c_hash
        if (payload.c_hash && typeof payload.c_hash === "string") {
            this.logger.trace("TokenValidator - Validating c_hash");

            if (!validationParams.code) {
                this.logger.verbose("C_hash present on token but code not set in validationParams. Unable to validate c_hash");
            } else {
                const hashResult = await this.checkHashValue(validationParams.code, payload.c_hash);
                if (!hashResult) {
                    throw ValidationError.createInvalidCHashError();
                }
            }
        }

        // Validate at_hash
        if (payload.at_hash && typeof payload.at_hash === "string") {
            this.logger.trace("TokenValidator - Validating at_hash");

            if (!validationParams.accessTokenForAtHash) {
                this.logger.verbose("At_hash present on token but access token not set in validationParams. Unable to validate at_hash");
            } else {
                const hashResult = await this.checkHashValue(validationParams.accessTokenForAtHash, payload.at_hash);
                if (!hashResult) {
                    throw ValidationError.createInvalidAtHashError();
                }
            }
        }
    }

    /**
     * Checking hash per OIDC spec, section 3.3.2.11 https://openid.net/specs/openid-connect-core-1_0.html#HybridTokenValidation
     * @param content 
     * @param hashProvided 
     * @returns 
     */
    async checkHashValue(content: string, hashProvided: string): Promise<Boolean> {
        this.logger.trace("TokenValidator.checkHashValue called");

        // 1. Hash the content (either code for c_hash, or token for at_hash) and save as buffer
        const digest = crypto.createHash("sha256").update(content, "ascii").digest();

        // 2. Only take left half of buffer, per OIDC spec
        const buffer = digest.slice(0, digest.length/2);

        // 3. Base64Url encode the buffer to get the hash
        const encodedHash = buffer.toString("base64url");

        return (hashProvided === encodedHash);
    }
}
