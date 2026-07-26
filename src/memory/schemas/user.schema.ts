import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type UserDocument = HydratedDocument<User>;

@Schema({ collection: "users", versionKey: false })
export class User {
  @Prop({ required: true, unique: true, index: true, trim: true })
  whatsapp_number!: string;

  @Prop({ required: true, default: Date.now })
  created_at!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
