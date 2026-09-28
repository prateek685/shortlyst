import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ClassificationModule } from "./classification/classification.module";
import { dataSourceOptions } from "./store/data-source";

@Module({
  imports: [TypeOrmModule.forRoot(dataSourceOptions), ClassificationModule],
})
export class AppModule {}
