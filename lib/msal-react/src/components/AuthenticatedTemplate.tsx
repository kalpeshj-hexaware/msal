/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import React, { PropsWithChildren, useMemo } from "react";
import { AccountIdentifiers } from "../types/AccountIdentifiers";
import { getChildrenOrFunction } from "../utils/utilities";
import { useMsal } from "../hooks/useMsal";
import { useIsAuthenticated } from "../hooks/useIsAuthenticated";

export type AuthenticatedTemplateProps = PropsWithChildren<AccountIdentifiers>;

/**
 * Renders child components if user is authenticated
 *
 * @param props
 * @param props.username
 * @param props.homeAccountId
 * @param props.localAccountId
 * @param props.children
 */
export function AuthenticatedTemplate({ username, homeAccountId, localAccountId, children }: AuthenticatedTemplateProps): React.ReactElement|null {
    const context = useMsal();
    const accountIdentifier: AccountIdentifiers = useMemo(() => {
        return {
            username,
            homeAccountId,
            localAccountId
        };
    }, [username, homeAccountId, localAccountId]);
    const isAuthenticated = useIsAuthenticated(accountIdentifier);

    if (isAuthenticated) {
        return (
            <React.Fragment>
                {getChildrenOrFunction(children, context)}
            </React.Fragment>
        );
    }
    return null;
}
