import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { AccountService } from "../services/accountService.js";

export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  deleteAccount = async (req: Request, res: Response) => {
    const result = await this.accountService.deleteAccount(req.auth!.userId);
    return sendSuccess(res, result);
  };
}
