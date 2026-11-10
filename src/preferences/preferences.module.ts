import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "../memory/schemas/user.schema";
import { PreferencesService } from "./preferences.service";

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [PreferencesService],
  exports: [PreferencesService]
})
export class PreferencesModule {}
