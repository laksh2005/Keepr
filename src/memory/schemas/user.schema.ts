import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type UserDocument = HydratedDocument<User>;

@Schema({ collection: "users", versionKey: false })
export class User {
  @Prop({ required: true, unique: true, index: true, trim: true })
  whatsapp_number!: string;

  @Prop({ required: true, default: Date.now })
  created_at!: Date;

  // Set when the person sends "stop": no reminders or weekly digest until "start".
  @Prop({ default: false })
  notifications_opted_out?: boolean;

  // When they last messaged Keepr; free-form replies are only allowed for 24h after.
  @Prop({ type: Date, default: null })
  last_inbound_at?: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
