import { httpCodeToMessage } from '@logto/core-kit';
import { useLogto } from '@logto/react';
import { getManagementApiResourceIndicator, type RequestErrorBody } from '@logto/schemas';
import { conditionalArray } from '@silverhand/essentials';
import ky from 'ky';
import { type KyInstance } from 'node_modules/ky/distribution/types/ky';
import { useCallback, useContext, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { requestTimeout } from '@/consts';
import { AppDataContext } from '@/contexts/AppDataProvider';
import { TenantsContext } from '@/contexts/TenantsProvider';

import { useConfirmModal } from './use-confirm-modal';
import useRedirectUri from './use-redirect-uri';

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: RequestErrorBody
  ) {
    super('Request error occurred.');
  }
}

export type StaticApiProps = {
  prefixUrl?: URL;
  hideErrorToast?: boolean;
  resourceIndicator: string;
};

export const useStaticApi = ({
  prefixUrl,
  hideErrorToast,
  resourceIndicator,
}: StaticApiProps): KyInstance => {
  const { isAuthenticated, getAccessToken, signOut } = useLogto();
  const { t, i18n } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { show } = useConfirmModal();
  const postSignOutRedirectUri = useRedirectUri('signOut');

  const toastError = useCallback(
    async (response: Response) => {
      const fallbackErrorMessage = t('errors.unknown_server_error');

      try {
        // Clone the response to avoid "Response body is already used".
        const data = await response.clone().json<RequestErrorBody>();

        // Inform and redirect un-authorized users to sign in page.
        if (data.code === 'auth.forbidden') {
          await show({
            ModalContent: data.message,
            type: 'alert',
            cancelButtonText: 'general.got_it',
          });

          await signOut(postSignOutRedirectUri.href);
          return;
        }

        toast.error([data.message, data.details].join('\n') || fallbackErrorMessage);
      } catch {
        toast.error(httpCodeToMessage[response.status] ?? fallbackErrorMessage);
      }
    },
    [show, signOut, t, postSignOutRedirectUri]
  );

  const api = useMemo(
    () =>
      ky.create({
        prefixUrl,
        timeout: requestTimeout,
        hooks: {
          beforeError: conditionalArray(
            !hideErrorToast &&
              (async (error) => {
                await toastError(error.response);
                return error;
              })
          ),
          beforeRequest: [
            async (request) => {
              if (isAuthenticated) {
                const accessToken = await getAccessToken(resourceIndicator);
                request.headers.set('Authorization', `Bearer ${accessToken ?? ''}`);
                request.headers.set('Accept-Language', i18n.language);
              }
            },
          ],
        },
      }),
    [
      prefixUrl,
      hideErrorToast,
      toastError,
      isAuthenticated,
      getAccessToken,
      resourceIndicator,
      i18n.language,
    ]
  );

  return api;
};

const useApi = (props: Omit<StaticApiProps, 'prefixUrl' | 'resourceIndicator'> = {}) => {
  const { tenantEndpoint } = useContext(AppDataContext);
  const { currentTenantId } = useContext(TenantsContext);

  return useStaticApi({
    ...props,
    prefixUrl: tenantEndpoint,
    resourceIndicator: getManagementApiResourceIndicator(currentTenantId),
  });
};

export default useApi;
