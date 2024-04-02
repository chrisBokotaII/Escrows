import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";

describe("Lock", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployOneYearLockFixture() {
    const oneEthr = hre.ethers.parseEther("1");

    // Contracts are deployed using the first signer/account by default
    const [seller, delivery, buyer, executor] = await hre.ethers.getSigners();

    const Lock = await hre.ethers.getContractFactory("Lock");
    const lock = await Lock.connect(seller).deploy(delivery.address);
    const Arbitor = await hre.ethers.getContractFactory("Arbitor");
    const arbitor = await Arbitor.connect(executor).deploy(seller.address);

    return { lock, seller, delivery, buyer, executor, oneEthr, arbitor };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { lock, seller } = await loadFixture(deployOneYearLockFixture);

      expect(await lock.seller()).to.equal(seller.address);
    });
    it("should deposit the right amount", async function () {
      const { lock, seller, delivery, buyer, executor, oneEthr, arbitor } =
        await loadFixture(deployOneYearLockFixture);
      const depot = await lock.connect(buyer).deposit(1, { value: oneEthr });
      const event = await lock.queryFilter(
        //@ts-ignore
        "Deposited",
        depot.blockNumber,
        depot.blockNumber
      );
      const secondDepot = await lock.connect(buyer).deposit(2, {
        value: oneEthr,
      });
      const event2 = await lock.queryFilter(
        //@ts-ignore
        "Deposited",
        secondDepot.blockNumber,
        secondDepot.blockNumber
      );
      const secondID = event2[0].args.transactionIndex;
      const deliver = await lock.connect(delivery).confirmDelivery(secondID);
      const deliveryEvent = await lock.queryFilter(
        //@ts-ignore
        "DeliveryConfirmed",
        deliver.blockNumber,
        deliver.blockNumber
      );
      console.log(await hre.ethers.provider.getBalance(lock.target));

      expect(await hre.ethers.provider.getBalance(lock.target)).to.equal(
        oneEthr + oneEthr
      );

      const confirm = await lock.connect(buyer).deliveryConfirm(secondID);
      await confirm.wait();
      const demand = await lock
        .connect(seller)
        .requestForFund(secondID, arbitor.target);
      const rqEvent = await lock.queryFilter(
        //@ts-ignore
        "FundRequested",
        demand.blockNumber,
        demand.blockNumber
      );
      const txe = await arbitor.queryFilter(
        //@ts-ignore
        "TransactionCreated",
        demand.blockNumber,
        demand.blockNumber
      );
      expect(await arbitor.hasVoted(txe[0].args.id, seller.address)).to.equal(
        false
      );
      expect(await arbitor.hasVoted(txe[0].args.id, executor.address)).to.equal(
        false
      );
      const vote1 = await arbitor
        .connect(seller)
        .signTransaction(txe[0].args.id);
      const vote2 = await arbitor
        .connect(executor)
        .signTransaction(txe[0].args.id);
      //move time
      await hre.ethers.provider.send("evm_increaseTime", [36001]);

      const executetx = await arbitor
        .connect(executor)
        .executeTransaction(txe[0].args.id, lock.target);
      const execEvent = await arbitor.queryFilter(
        //@ts-ignore
        "TransactionConfirmed",
        executetx.blockNumber,
        executetx.blockNumber
      );
      console.log(await hre.ethers.provider.getBalance(lock.target));

      console.log(await hre.ethers.provider.getBalance(arbitor.target));

      expect(await arbitor.hasVoted(txe[0].args.id, seller.address)).to.equal(
        true
      );
      expect(await arbitor.hasVoted(txe[0].args.id, executor.address)).to.equal(
        true
      );

      expect(secondID).to.equal(deliveryEvent[0].args.transactionIndex);
    });
  });
  describe("error check", function () {
    it("should not be able to deposit with zero amount", async function () {
      const { lock, seller, delivery, buyer, executor, oneEthr, arbitor } =
        await loadFixture(deployOneYearLockFixture);
      await expect(
        lock.connect(buyer).deposit(1, { value: 0 })
      ).to.be.revertedWith("You need to send some ether");
    });
    it("should not confirm delivery if not delivery agency", async function () {
      const { lock, seller, delivery, buyer, executor, oneEthr, arbitor } =
        await loadFixture(deployOneYearLockFixture);
      const deposit = await lock.connect(buyer).deposit(1, { value: oneEthr });
      const depotevent = await lock.queryFilter(
        //@ts-ignore
        "Deposited",
        deposit.blockNumber,
        deposit.blockNumber
      );
      const id = depotevent[0].args.transactionIndex;
      await expect(lock.connect(buyer).confirmDelivery(id)).to.be.revertedWith(
        "You are not the delivery agency"
      );
      const confirm = await lock.connect(delivery).confirmDelivery(id);
      await confirm.wait();
      await expect(
        lock.connect(delivery).confirmDelivery(id)
      ).to.be.revertedWith("Delivery already confirmed");
    });
    it("should not confirm package received if not the buyer", async function () {
      const { lock, seller, delivery, buyer, executor, oneEthr, arbitor } =
        await loadFixture(deployOneYearLockFixture);
      const deposit = await lock.connect(buyer).deposit(1, { value: oneEthr });
      const depotevent = await lock.queryFilter(
        //@ts-ignore
        "Deposited",
        deposit.blockNumber,
        deposit.blockNumber
      );
      const id = depotevent[0].args.transactionIndex;
      await expect(lock.connect(buyer).deliveryConfirm(id)).to.be.revertedWith(
        "Delivery not yet confirmed by delivery agency"
      );
      const deliver = await lock.connect(delivery).confirmDelivery(id);
      const deliveryEvent = await lock.queryFilter(
        //@ts-ignore
        "DeliveryConfirmed",
        deliver.blockNumber,
        deliver.blockNumber
      );
      expect(await hre.ethers.provider.getBalance(lock.target)).to.equal(
        oneEthr
      );
      await expect(lock.connect(seller).deliveryConfirm(id)).to.be.revertedWith(
        "Only the buyer can confirm the delivery"
      );
    });
    //TODO:: add more error check
  });

  describe("raise a dispute", function () {
    it("should raise a dispute", async function () {
      const { lock, seller, delivery, buyer, executor, oneEthr, arbitor } =
        await loadFixture(deployOneYearLockFixture);
      const deposit = await lock.connect(buyer).deposit(1, { value: oneEthr });
      const depotevent = await lock.queryFilter(
        //@ts-ignore
        "Deposited",
        deposit.blockNumber,
        deposit.blockNumber
      );
      const id = depotevent[0].args.transactionIndex;
      const deliver = await lock.connect(delivery).confirmDelivery(id);
      const deliveryEvent = await lock.queryFilter(
        //@ts-ignore
        "DeliveryConfirmed",
        deliver.blockNumber,
        deliver.blockNumber
      );
      const confirm = await lock.connect(buyer).deliveryConfirm(id);
      await confirm.wait();

      const demand = await lock
        .connect(seller)
        .requestForFund(id, arbitor.target);
      const rqEvent = await lock.queryFilter(
        //@ts-ignore
        "FundRequested",
        demand.blockNumber,
        demand.blockNumber
      );
      const txe = await arbitor.queryFilter(
        //@ts-ignore
        "TransactionCreated",
        demand.blockNumber,
        demand.blockNumber
      );

      const dispute = await arbitor
        .connect(buyer)
        .raiseDispute(txe[0].args.id, "test");
      const disputeEvent = await arbitor.queryFilter(
        //@ts-ignore
        "DisputeRaised",
        dispute.blockNumber,
        dispute.blockNumber
      );
      // const resolve = await arbitor
      //   .connect(executor)
      //   .resolveDispute(txe[0].args.id);
      const vote1 = await arbitor
        .connect(seller)
        .signTransaction(txe[0].args.id);
      const vote2 = await arbitor
        .connect(executor)
        .signTransaction(txe[0].args.id);
      expect(await arbitor.hasVoted(txe[0].args.id, seller.address)).to.equal(
        true
      );
      expect(await arbitor.hasVoted(txe[0].args.id, executor.address)).to.equal(
        true
      );
      hre.ethers.provider.send("evm_increaseTime", [864005]);

      const refund = await arbitor
        .connect(executor)
        .refundTransaction(txe[0].args.id, lock.target);
      console.log(await hre.ethers.provider.getBalance(arbitor.target));

      expect(disputeEvent[0].args.id).to.equal(txe[0].args.id);
      expect(disputeEvent[0].args.reason).to.equal("test");
    });
  });
});
