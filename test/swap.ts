import { ethers } from "@nomiclabs/buidler"
import { Wallet, Signer, BigNumber } from "ethers"
import chai from "chai"
import { deployContract, solidity } from "ethereum-waffle"

import SwapUtilsArtifact from "../build/artifacts/SwapUtils.json"
import { SwapUtils } from "../build/typechain/SwapUtils"

import SwapArtifact from "../build/artifacts/Swap.json"
import { Swap } from "../build/typechain/Swap"

import LPTokenArtifact from "../build/artifacts/LPToken.json"
import { LpToken } from "../build/typechain/LpToken"

import MathUtilsArtifact from "../build/artifacts/MathUtils.json"
import { MathUtils } from "../build/typechain/MathUtils"

import { deployContractWithLibraries, getTokenBalances } from "./testUtils"

chai.use(solidity)
const { expect } = chai

describe("Swap", () => {
  let signers: Array<Signer>
  let swap: Swap
  let mathUtils: MathUtils
  let swapUtils: SwapUtils
  let firstToken: LpToken
  let secondToken: LpToken
  let swapToken: LpToken
  let owner: Signer
  let user1: Signer
  let user2: Signer
  let swapStorage: {
    lpToken: string
    A: BigNumber
    fee: BigNumber
    adminFee: BigNumber
    "0": string
    "1": BigNumber
    "2": BigNumber
    "3": BigNumber
  }

  // Test Values
  const INITIAL_A_VALUE = 50
  const SWAP_FEE = 1e7
  const LP_TOKEN_NAME = "Test LP Token Name"
  const LP_TOKEN_SYMBOL = "TESTLP"

  beforeEach(async () => {
    signers = await ethers.getSigners()
    owner = signers[0]
    user1 = signers[1]
    user2 = signers[2]

    // Deploy dummy tokens
    firstToken = (await deployContract(owner as Wallet, LPTokenArtifact, [
      "First Token",
      "FIRST",
    ])) as LpToken

    secondToken = (await deployContract(owner as Wallet, LPTokenArtifact, [
      "Second Token",
      "SECOND",
    ])) as LpToken

    // Mint dummy tokens
    await firstToken.mint(await owner.getAddress(), String(1e20))
    await secondToken.mint(await owner.getAddress(), String(1e20))

    await firstToken.mint(await user1.getAddress(), String(1e20))
    await secondToken.mint(await user1.getAddress(), String(1e20))

    await firstToken.mint(await user2.getAddress(), String(1e20))
    await secondToken.mint(await user2.getAddress(), String(1e20))

    // Deploy MathUtils
    mathUtils = (await deployContract(
      signers[0] as Wallet,
      MathUtilsArtifact,
    )) as MathUtils

    // Deploy SwapUtils with MathUtils library
    swapUtils = (await deployContractWithLibraries(owner, SwapUtilsArtifact, {
      MathUtils: mathUtils.address,
    })) as SwapUtils
    await swapUtils.deployed()

    // Deploy Swap with SwapUtils library
    swap = (await deployContractWithLibraries(
      owner,
      SwapArtifact,
      { SwapUtils: swapUtils.address },
      [
        [firstToken.address, secondToken.address],
        [String(1e18), String(1e18)],
        LP_TOKEN_NAME,
        LP_TOKEN_SYMBOL,
        INITIAL_A_VALUE,
        SWAP_FEE,
      ],
    )) as Swap
    await swap.deployed()

    swapStorage = await swap.swapStorage()

    swapToken = (await ethers.getContractAt(
      LPTokenArtifact.abi,
      swapStorage.lpToken,
    )) as LpToken

    // Populate the pool with initial liquidity
    await firstToken.approve(swap.address, ethers.constants.MaxUint256)
    await secondToken.approve(swap.address, ethers.constants.MaxUint256)
    await swap.addLiquidity([String(1e18), String(1e18)], 0)

    await firstToken
      .connect(user1)
      .approve(swap.address, ethers.constants.MaxUint256)
    await secondToken
      .connect(user1)
      .approve(swap.address, ethers.constants.MaxUint256)

    await firstToken
      .connect(user2)
      .approve(swap.address, ethers.constants.MaxUint256)
    await secondToken
      .connect(user2)
      .approve(swap.address, ethers.constants.MaxUint256)
  })

  describe("swapStorage", () => {
    describe("lpToken", async () => {
      it("Returns correct lpTokeName", async () => {
        expect(await swapToken.name()).to.eq(LP_TOKEN_NAME)
      })
      it("Returns correct lpTokenSymbol", async () => {
        expect(await swapToken.symbol()).to.eq(LP_TOKEN_SYMBOL)
      })
    })

    describe("A", async () => {
      it("Returns correct A value", async () => {
        expect(swapStorage.A).to.eq(INITIAL_A_VALUE)
      })
    })

    describe("fee", async () => {
      it("Returns correct fee value", async () => {
        expect(swapStorage.fee).to.eq(SWAP_FEE)
      })
    })

    describe("adminFee", async () => {
      it("Returns correct adminFee value", async () => {
        expect(swapStorage.adminFee).to.eq(0)
      })
    })
  })

  describe("getToken", () => {
    it("Returns correct addresses of pooled tokens", async () => {
      expect(await swap.getToken(0)).to.eq(firstToken.address)
      expect(await swap.getToken(1)).to.eq(secondToken.address)
    })

    it("Reverts when index is out of range", async () => {
      expect(swap.getToken(2)).to.be.reverted
    })
  })

  describe("getTokenBalance", () => {
    it("Returns correct balances of pooled tokens", async () => {
      expect(await swap.getTokenBalance(0)).to.eq(BigNumber.from(String(1e18)))
      expect(await swap.getTokenBalance(1)).to.eq(BigNumber.from(String(1e18)))
    })

    it("Reverts when index is out of range", async () => {
      expect(swap.getTokenBalance(2)).to.be.reverted
    })
  })

  describe("getA", () => {
    it("Returns correct value", async () => {
      expect(await swap.getA()).to.eq(INITIAL_A_VALUE)
    })
  })

  describe("addLiquidity", () => {
    it("Reverts when contract is paused", async () => {
      await swap.pause()

      expect(swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0))
        .to.be.reverted
    })

    it("Succeeds with expected output amount of pool tokens", async () => {
      const calculatedPoolTokenAmount = await swap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedPoolTokenAmountWithSlippage = calculatedPoolTokenAmount
        .mul(999)
        .div(1000)

      await swap
        .connect(user1)
        .addLiquidity(
          [String(1e18), String(3e18)],
          calculatedPoolTokenAmountWithSlippage,
        )

      const actualPoolTokenAmount = await swapToken.balanceOf(
        await user1.getAddress(),
      )

      // The actual pool token amount is less than 4e18 due to the imbalance of the underlying tokens
      expect(actualPoolTokenAmount).to.eq(BigNumber.from("3991672211258372957"))
    })

    it("Succeeds with actual pool token amount being within ±0.1% range of calculated pool token", async () => {
      const calculatedPoolTokenAmount = await swap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedPoolTokenAmountWithNegativeSlippage = calculatedPoolTokenAmount
        .mul(999)
        .div(1000)

      const calculatedPoolTokenAmountWithPositiveSlippage = calculatedPoolTokenAmount
        .mul(1001)
        .div(1000)

      await swap
        .connect(user1)
        .addLiquidity(
          [String(1e18), String(3e18)],
          calculatedPoolTokenAmountWithNegativeSlippage,
        )

      const actualPoolTokenAmount = await swapToken.balanceOf(
        await user1.getAddress(),
      )

      expect(actualPoolTokenAmount).to.gte(
        calculatedPoolTokenAmountWithNegativeSlippage,
      )

      expect(actualPoolTokenAmount).to.lte(
        calculatedPoolTokenAmountWithPositiveSlippage,
      )
    })

    it("Succeeds with correctly updated tokenBalance after imbalanced deposit", async () => {
      await swap.connect(user1).addLiquidity([String(1e18), String(3e18)], 0)

      // Check updated token balance
      expect(await swap.getTokenBalance(0)).to.eq(BigNumber.from(String(2e18)))
      expect(await swap.getTokenBalance(1)).to.eq(BigNumber.from(String(4e18)))
    })

    it("Reverts when minToMint is not reached due to front running", async () => {
      const calculatedLPTokenAmount = await swap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedLPTokenAmountWithSlippage = calculatedLPTokenAmount
        .mul(999)
        .div(1000)

      // Someone else deposits thus front running user 1's deposit
      await swap.addLiquidity([String(1e18), String(3e18)], 0)

      expect(
        swap
          .connect(user1)
          .addLiquidity(
            [String(1e18), String(3e18)],
            calculatedLPTokenAmountWithSlippage,
          ),
      ).to.be.reverted
    })

    it("Emits addLiquidity event", async () => {
      const calculatedLPTokenAmount = await swap
        .connect(user1)
        .calculateTokenAmount([String(2e18), String(1e16)], true)

      const calculatedLPTokenAmountWithSlippage = calculatedLPTokenAmount
        .mul(999)
        .div(1000)

      expect(
        swap
          .connect(user1)
          .addLiquidity(
            [String(2e18), String(1e16)],
            calculatedLPTokenAmountWithSlippage,
          ),
      ).to.emit(swap.connect(user1), "AddLiquidity")
    })
  })

  describe("removeLiquidity", () => {
    it("Succeeds even when contract is paused", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await swap.pause()

      // Owner and user 1 try to remove liquidity
      swapToken.approve(swap.address, String(2e18))
      swapToken.connect(user1).approve(swap.address, currentUser1Balance)

      await swap.removeLiquidity(String(2e18), [0, 0])
      await swap.connect(user1).removeLiquidity(currentUser1Balance, [0, 0])
      expect(await firstToken.balanceOf(swap.address)).to.eq(0)
      expect(await secondToken.balanceOf(swap.address)).to.eq(0)
    })

    it("Succeeds with expected return amounts of underlying tokens", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)

      const [
        firstTokenBalanceBefore,
        secondTokenBalanceBefore,
        poolTokenBalanceBefore,
      ] = await getTokenBalances(user1, firstToken, secondToken, swapToken)

      expect(poolTokenBalanceBefore).to.eq(
        BigNumber.from("1996275270169644725"),
      )

      const [
        expectedFirstTokenAmount,
        expectedSecondTokenAmount,
      ] = await swap.calculateRemoveLiquidity(poolTokenBalanceBefore)

      expect(expectedFirstTokenAmount).to.eq(
        BigNumber.from("1498601924450190405"),
      )
      expect(expectedSecondTokenAmount).to.eq(
        BigNumber.from("504529314564897436"),
      )

      // User 1 removes liquidity
      await swapToken
        .connect(user1)
        .approve(swap.address, poolTokenBalanceBefore)
      await swap
        .connect(user1)
        .removeLiquidity(poolTokenBalanceBefore, [
          expectedFirstTokenAmount,
          expectedSecondTokenAmount,
        ])

      const [
        firstTokenBalanceAfter,
        secondTokenBalanceAfter,
      ] = await getTokenBalances(user1, firstToken, secondToken)

      // Check the actual returned token amounts match the expected amounts
      expect(firstTokenBalanceAfter.sub(firstTokenBalanceBefore)).to.eq(
        expectedFirstTokenAmount,
      )
      expect(secondTokenBalanceAfter.sub(secondTokenBalanceBefore)).to.eq(
        expectedSecondTokenAmount,
      )
    })

    it("Reverts when minAmounts of underlying tokens are not reached due to front running", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      const [
        expectedFirstTokenAmount,
        expectedSecondTokenAmount,
      ] = await swap.calculateRemoveLiquidity(currentUser1Balance)

      expect(expectedFirstTokenAmount).to.eq(
        BigNumber.from("1498601924450190405"),
      )
      expect(expectedSecondTokenAmount).to.eq(
        BigNumber.from("504529314564897436"),
      )

      // User 2 adds liquidity, which leads to change in balance of underlying tokens
      await swap.connect(user2).addLiquidity([String(1e16), String(2e18)], 0)

      // User 1 tries to remove liquidity which get reverted due to front running
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      expect(
        swap
          .connect(user1)
          .removeLiquidity(currentUser1Balance, [
            expectedFirstTokenAmount,
            expectedSecondTokenAmount,
          ]),
      ).to.be.reverted
    })

    it("Emits removeLiquidity event", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )

      // User 1 removes liquidity
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap.connect(user1).removeLiquidity(currentUser1Balance, [0, 0]),
      ).to.emit(swap.connect(user1), "RemoveLiquidity")
    })
  })

  describe("removeLiquidityImbalance", () => {
    it("Reverts when contract is paused.", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await swap.pause()

      // Owner and user 1 try to initiate imbalanced liquidity withdrawal
      swapToken.approve(swap.address, ethers.constants.MaxUint256)
      swapToken
        .connect(user1)
        .approve(swap.address, ethers.constants.MaxUint256)

      await expect(
        swap.removeLiquidityImbalance(
          [String(1e18), String(1e16)],
          ethers.constants.MaxUint256,
        ),
      ).to.be.reverted

      await expect(
        swap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            ethers.constants.MaxUint256,
          ),
      ).to.be.reverted
    })

    it("Succeeds with calculated max amount of pool token to be burned (±0.1%)", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates amount of pool token to be burned
      const maxPoolTokenAmountToBeBurned = await swap.calculateTokenAmount(
        [String(1e18), String(1e16)],
        false,
      )

      // ±0.1% range of pool token to be burned
      const maxPoolTokenAmountToBeBurnedNegativeSlippage = maxPoolTokenAmountToBeBurned
        .mul(1001)
        .div(1000)
      const maxPoolTokenAmountToBeBurnedPositiveSlippage = maxPoolTokenAmountToBeBurned
        .mul(999)
        .div(1000)

      const [
        firstTokenBalanceBefore,
        secondTokenBalanceBefore,
        poolTokenBalanceBefore,
      ] = await getTokenBalances(user1, firstToken, secondToken, swapToken)

      // User 1 withdraws imbalanced tokens
      await swapToken
        .connect(user1)
        .approve(swap.address, maxPoolTokenAmountToBeBurnedNegativeSlippage)
      await swap
        .connect(user1)
        .removeLiquidityImbalance(
          [String(1e18), String(1e16)],
          maxPoolTokenAmountToBeBurnedNegativeSlippage,
        )

      const [
        firstTokenBalanceAfter,
        secondTokenBalanceAfter,
        poolTokenBalanceAfter,
      ] = await getTokenBalances(user1, firstToken, secondToken, swapToken)

      // Check the actual returned token amounts match the requested amounts
      expect(firstTokenBalanceAfter.sub(firstTokenBalanceBefore)).to.eq(
        String(1e18),
      )
      expect(secondTokenBalanceAfter.sub(secondTokenBalanceBefore)).to.eq(
        String(1e16),
      )

      // Check the actual burned pool token amount
      const actualPoolTokenBurned = poolTokenBalanceBefore.sub(
        poolTokenBalanceAfter,
      )

      expect(actualPoolTokenBurned).to.eq(String("1000934178112841888"))
      expect(actualPoolTokenBurned).to.gte(
        maxPoolTokenAmountToBeBurnedPositiveSlippage,
      )
      expect(actualPoolTokenBurned).to.lte(
        maxPoolTokenAmountToBeBurnedNegativeSlippage,
      )
    })

    it("Reverts when minAmounts of underlying tokens are not reached due to front running", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates amount of pool token to be burned
      const maxPoolTokenAmountToBeBurned = await swap.calculateTokenAmount(
        [String(1e18), String(1e16)],
        false,
      )

      // Calculate +0.1% of pool token to be burned
      const maxPoolTokenAmountToBeBurnedNegativeSlippage = maxPoolTokenAmountToBeBurned
        .mul(1001)
        .div(1000)

      // User 2 adds liquidity, which leads to change in balance of underlying tokens
      await swap.connect(user2).addLiquidity([String(1e16), String(1e20)], 0)

      // User 1 tries to remove liquidity which get reverted due to front running
      await swapToken
        .connect(user1)
        .approve(swap.address, maxPoolTokenAmountToBeBurnedNegativeSlippage)
      await expect(
        swap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            maxPoolTokenAmountToBeBurnedNegativeSlippage,
          ),
      ).to.be.reverted
    })

    it("Emits RemoveLiquidityImbalance event", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )

      // User 1 removes liquidity
      await swapToken
        .connect(user1)
        .approve(swap.address, ethers.constants.MaxUint256)

      await expect(
        swap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            currentUser1Balance,
          ),
      ).to.emit(swap.connect(user1), "RemoveLiquidityImbalance")
    })
  })

  describe("removeLiquidityOneToken", () => {
    it("Reverts when contract is paused.", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await swap.pause()

      // Owner and user 1 try to remove liquidity via single token
      swapToken.approve(swap.address, String(2e18))
      swapToken.connect(user1).approve(swap.address, currentUser1Balance)

      expect(swap.removeLiquidityOneToken(String(2e18), 0, 0)).to.be.reverted
      expect(
        swap.connect(user1).removeLiquidityOneToken(currentUser1Balance, 0, 0),
      ).to.be.reverted
    })

    it("Succeeds with calculated token amount as minAmount", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates the amount of underlying token to receive.
      const calculatedFirstTokenAmount = await swap.calculateRemoveLiquidityOneToken(
        currentUser1Balance,
        0,
      )
      expect(calculatedFirstTokenAmount).to.eq(
        BigNumber.from("2008990034631583696"),
      )

      // User 1 initiates one token withdrawal
      const before = await firstToken.balanceOf(await user1.getAddress())
      swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await swap
        .connect(user1)
        .removeLiquidityOneToken(
          currentUser1Balance,
          0,
          calculatedFirstTokenAmount,
        )
      const after = await firstToken.balanceOf(await user1.getAddress())

      expect(after.sub(before)).to.eq(BigNumber.from("2008990034631583696"))
    })

    it("Reverts when minAmount of underlying token is not reached due to front running", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates the amount of underlying token to receive.
      const calculatedFirstTokenAmount = await swap.calculateRemoveLiquidityOneToken(
        currentUser1Balance,
        0,
      )
      expect(calculatedFirstTokenAmount).to.eq(
        BigNumber.from("2008990034631583696"),
      )

      // User 2 adds liquidity before User 1 initiates withdrawal
      await swap.connect(user2).addLiquidity([String(1e16), String(1e20)], 0)

      // User 1 initiates one token withdrawal
      swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      expect(
        swap
          .connect(user1)
          .removeLiquidityOneToken(
            currentUser1Balance,
            0,
            calculatedFirstTokenAmount,
          ),
      ).to.be.reverted
    })

    it("Emits RemoveLiquidityOne event", async () => {
      // User 1 adds liquidity
      await swap.connect(user1).addLiquidity([String(2e18), String(1e16)], 0)
      const currentUser1Balance = await swapToken.balanceOf(
        await user1.getAddress(),
      )

      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap.connect(user1).removeLiquidityOneToken(currentUser1Balance, 0, 0),
      ).to.emit(swap.connect(user1), "RemoveLiquidityOne")
    })
  })
})
