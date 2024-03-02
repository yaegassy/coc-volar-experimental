import {
  AutoInsertRequest,
  FindFileReferenceRequest,
  GetVirtualFileRequest,
  ReloadProjectNotification,
} from '@vue/language-server';
import * as coc from 'coc.nvim';

/**
 * Client Requests
 */

export const FindFileReferenceRequestType = new coc.RequestType<
  FindFileReferenceRequest.ParamsType,
  FindFileReferenceRequest.ResponseType,
  FindFileReferenceRequest.ErrorType
>(FindFileReferenceRequest.type.method);

export const AutoInsertRequestType = new coc.RequestType<
  AutoInsertRequest.ParamsType,
  AutoInsertRequest.ResponseType,
  AutoInsertRequest.ErrorType
>(AutoInsertRequest.type.method);

export const ReloadProjectNotificationType = new coc.NotificationType(ReloadProjectNotification.type.method);

export const GetVirtualFileRequestType = new coc.RequestType<
  GetVirtualFileRequest.ParamsType,
  GetVirtualFileRequest.ResponseType,
  GetVirtualFileRequest.ErrorType
>(GetVirtualFileRequest.type.method);
